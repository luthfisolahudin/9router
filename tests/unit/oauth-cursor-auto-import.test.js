import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// os is mocked with a mutable home so the route's `homedir()` calls can be redirected.
const { getHome, setHome } = vi.hoisted(() => {
  let home = "";
  return { getHome: () => home, setHome: (value) => { home = value; } };
});
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual, homedir: getHome }, homedir: getHome };
});

// child_process backs both the sqlite3 CLI fallback and the Linux install check.
const execFileMock = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args) => execFileMock(...args),
}));

import { GET } from "../../src/app/api/oauth/cursor/auto-import/route.js";

const REAL_PLATFORM = process.platform;
const DARWIN_DB = "Library/Application Support/Cursor/User/globalStorage/state.vscdb";
const LINUX_DB = ".config/Cursor/User/globalStorage/state.vscdb";

function writeCursorDb(home, rows, { platform = "darwin" } = {}) {
  const dbPath = path.join(home, platform === "darwin" ? DARWIN_DB : LINUX_DB);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // better-sqlite3 picks its prebuild from process.platform — open the db with
  // the real platform while the route still sees the simulated one.
  const simulated = process.platform;
  Object.defineProperty(process, "platform", { value: REAL_PLATFORM, writable: true });
  try {
    const db = new Database(dbPath);
    db.exec("CREATE TABLE itemTable (key TEXT PRIMARY KEY, value TEXT)");
    const insert = db.prepare("INSERT INTO itemTable (key, value) VALUES (?, ?)");
    for (const [key, value] of rows) insert.run(key, value);
    db.close();
  } finally {
    Object.defineProperty(process, "platform", { value: simulated, writable: true });
  }
  return dbPath;
}

// Promisified execFile receives the callback as last argument; fail by default.
function execFails() {
  execFileMock.mockImplementation((...args) => {
    const cb = typeof args.at(-1) === "function" ? args.at(-1) : () => {};
    const err = new Error("ENOENT: no such binary");
    err.code = "ENOENT";
    cb(err, { stdout: "", stderr: "" });
  });
}

function execReturnsByKey(map) {
  execFileMock.mockImplementation((file, args, ...rest) => {
    const cb = typeof rest.at(-1) === "function" ? rest.at(-1) : () => {};
    if (file !== "sqlite3") return cb(new Error("ENOENT"), { stdout: "", stderr: "" });
    const sql = String(args?.[1] || "");
    const key = sql.match(/key='([^']+)'/)?.[1];
    cb(null, { stdout: map[key] ?? "", stderr: "" });
  });
}

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;
  let home;

  beforeEach(() => {
    vi.clearAllMocks();
    home = fs.mkdtempSync(path.join(os.tmpdir(), "9r-cursor-"));
    setHome(home);
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    execFails();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("returns not-found when no Cursor database exists", async () => {
    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found. Checked locations:");
    expect(response.body.error).toContain(DARWIN_DB);
  });

  it("extracts tokens via the bundled better-sqlite3 driver", async () => {
    writeCursorDb(home, [
      ["cursorAuth/accessToken", "test-token"],
      ["storage.serviceMachineId", "test-machine-id"],
    ]);

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
    // Native driver succeeded — the CLI fallback must not run.
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("unwraps JSON-encoded string values", async () => {
    writeCursorDb(home, [
      ["cursorAuth/accessToken", JSON.stringify("json-token")],
      ["storage.serviceMachineId", JSON.stringify("json-machine-id")],
    ]);

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  it("falls back to the sqlite3 CLI when the native driver cannot open the db", async () => {
    // A plain file at the candidate path makes better-sqlite3 throw.
    const dbPath = path.join(home, DARWIN_DB);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, "not a sqlite database");
    execReturnsByKey({
      "cursorAuth/accessToken": "cli-token",
      "storage.serviceMachineId": "cli-machine-id",
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("cli-token");
    expect(response.body.machineId).toBe("cli-machine-id");
    expect(execFileMock).toHaveBeenCalled();
    expect(execFileMock.mock.calls[0][0]).toBe("sqlite3");
  });

  it("asks for manual import when tokens are missing everywhere", async () => {
    const dbPath = writeCursorDb(home, [["unrelated", "value"]]);

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toBe(dbPath);
  });

  it("linux: config present but Cursor not installed → skipped", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    writeCursorDb(home, [["cursorAuth/accessToken", "t"]], { platform: "linux" });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("does not appear to be installed");
  });

  it("non-darwin/win32 platforms probe the linux-style paths", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain(".config/Cursor/User/globalStorage/state.vscdb");
  });
});
