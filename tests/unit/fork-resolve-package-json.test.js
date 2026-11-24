import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Drives the real resolver against a throwaway repository: the workspace holds
// three manifests, so a root-only resolver leaves cli/ and tests/ conflicted and
// aborts the nightly upstream sync.

const resolver = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/fork/resolve-package-json.mjs"
);

const MANIFESTS = {
  "package.json": { name: "root", version: "1.0.0", dependencies: { next: "^16.4.0" } },
  "cli/package.json": { name: "cli", version: "1.0.0", dependencies: { "node-forge": "^1.3.3" } },
  "tests/package.json": { name: "tests", version: "1.0.0", devDependencies: { vitest: "^4.0.0" } },
};

let repo;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function write(cwd, manifest, value) {
  fs.mkdirSync(path.dirname(path.join(cwd, manifest)), { recursive: true });
  fs.writeFileSync(path.join(cwd, manifest), `${JSON.stringify(value, null, 2)}\n`);
}

function read(cwd, manifest) {
  return JSON.parse(fs.readFileSync(path.join(cwd, manifest), "utf8"));
}

function commitAll(cwd, message) {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-qm", message]);
}

// Builds base -> upstream + fork branches where every manifest diverges, then
// leaves the merge conflicted the way a sync lands it.
function conflictedRepo(forkManifests, upstreamManifests) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "9router-resolver-"));
  git(cwd, ["init", "-q", "-b", "main"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "test"]);
  for (const [manifest, value] of Object.entries(MANIFESTS)) write(cwd, manifest, value);
  commitAll(cwd, "base");

  git(cwd, ["checkout", "-q", "-b", "upstream"]);
  for (const [manifest, value] of Object.entries(upstreamManifests)) write(cwd, manifest, value);
  commitAll(cwd, "upstream");

  git(cwd, ["checkout", "-q", "main"]);
  for (const [manifest, value] of Object.entries(forkManifests)) write(cwd, manifest, value);
  commitAll(cwd, "fork");

  try {
    git(cwd, ["merge", "--no-ff", "--no-commit", "upstream"]);
  } catch {
    // conflicts are the setup, not the failure
  }
  return cwd;
}

afterEach(() => {
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
  repo = undefined;
});

describe("fork package.json conflict resolver", () => {
  it("resolves every conflicted workspace manifest in one run", () => {
    repo = conflictedRepo(
      {
        "package.json": { ...MANIFESTS["package.json"], dependencies: { next: "^16.4.5" } },
        "cli/package.json": { name: "cli", version: "1.0.0", dependencies: {} },
        "tests/package.json": { ...MANIFESTS["tests/package.json"], devDependencies: { vitest: "^5.1.0" } },
      },
      {
        "package.json": { ...MANIFESTS["package.json"], version: "2.0.0", dependencies: { next: "^16.4.6" } },
        "cli/package.json": { name: "cli", version: "2.0.0", dependencies: { "node-forge": "^1.4.3" } },
        "tests/package.json": { name: "tests", version: "2.0.0", devDependencies: { vitest: "^5.0.5" } },
      }
    );

    execFileSync("node", [resolver], { cwd: repo, encoding: "utf8", stdio: "pipe" });

    expect(git(repo, ["diff", "--name-only", "--diff-filter=U"]).trim()).toBe("");
    expect(read(repo, "package.json").dependencies.next).toBe("^16.4.6");
    expect(read(repo, "cli/package.json").dependencies).toEqual({ "node-forge": "^1.4.3" });
    expect(read(repo, "tests/package.json").devDependencies.vitest).toBe("^5.1.0");
  });

  it("takes an upstream edit when the fork deleted the dependency", () => {
    repo = conflictedRepo(
      { "cli/package.json": { name: "cli", version: "1.0.0", dependencies: {} } },
      { "cli/package.json": { name: "cli", version: "2.0.0", dependencies: { "node-forge": "^1.4.3" } } }
    );

    execFileSync("node", [resolver], { cwd: repo, encoding: "utf8", stdio: "pipe" });

    // Documented rule: a fork deletion plus an upstream edit resolves to upstream.
    // The fork removed node-forge by hand because this rule restores it.
    expect(read(repo, "cli/package.json").version).toBe("2.0.0");
    expect(read(repo, "cli/package.json").dependencies).toEqual({ "node-forge": "^1.4.3" });
  });

  it("leaves non-manifest conflicts for the sync script to report", () => {
    const cwd = conflictedRepo(
      { "package.json": { ...MANIFESTS["package.json"], dependencies: { next: "^16.4.5" } } },
      { "package.json": { ...MANIFESTS["package.json"], dependencies: { next: "^16.4.6" } } }
    );
    repo = cwd;
    git(cwd, ["merge", "--abort"]);
    fs.writeFileSync(path.join(cwd, "some.js"), 'const x = "fork";\n');
    commitAll(cwd, "fork js");
    git(cwd, ["checkout", "-q", "upstream"]);
    fs.writeFileSync(path.join(cwd, "some.js"), 'const x = "upstream";\n');
    commitAll(cwd, "upstream js");
    git(cwd, ["checkout", "-q", "main"]);
    try {
      git(cwd, ["merge", "--no-ff", "--no-commit", "upstream"]);
    } catch {
      // expected
    }

    execFileSync("node", [resolver], { cwd, encoding: "utf8", stdio: "pipe" });

    expect(git(cwd, ["diff", "--name-only", "--diff-filter=U"]).trim()).toBe("some.js");
  });

  it("exits non-zero when nothing is conflicted", () => {
    repo = conflictedRepo(
      { "package.json": { ...MANIFESTS["package.json"], dependencies: { next: "^16.4.5" } } },
      { "package.json": { ...MANIFESTS["package.json"], dependencies: { next: "^16.4.6" } } }
    );
    git(repo, ["merge", "--abort"]);

    expect(() =>
      execFileSync("node", [resolver], { cwd: repo, encoding: "utf8", stdio: "pipe" })
    ).toThrow();
  });
});
