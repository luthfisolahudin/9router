import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Full-suite gate: run every test, absorb the known upstream-inherited reds in
// known-red.json, and fail on any new failure. `--results <file>` evaluates an
// existing vitest JSON report without running the suite.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const testsRoot = path.join(repoRoot, "tests");
const baseline = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "scripts/fork/known-red.json"), "utf8")
);

const expected = new Set();
for (const [file, names] of Object.entries(baseline.files || {})) {
  if (!fs.existsSync(path.join(testsRoot, file))) {
    console.warn(`[test-gate] baseline file no longer exists: ${file}`);
  }
  for (const name of names) expected.add(`${file} :: ${name}`);
}

function relativeTestFile(name) {
  const absolute = path.isAbsolute(name) ? name : path.resolve(testsRoot, name);
  return path.relative(testsRoot, absolute).split(path.sep).join("/");
}

const args = process.argv.slice(2);
const resultsIndex = args.indexOf("--results");
let jsonPath = resultsIndex >= 0 ? args[resultsIndex + 1] : null;
let tempDir = null;
let vitestStatus = 0;

if (resultsIndex >= 0 && !jsonPath) {
  console.error("usage: test-gate.mjs [--results <vitest-json>]");
  process.exit(2);
}

try {
  if (!jsonPath) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-test-gate-"));
    jsonPath = path.join(tempDir, "results.json");
    const run = spawnSync(
      "pnpm",
      [
        "-C",
        "tests",
        "exec",
        "vitest",
        "run",
        "--reporter=dot",
        "--reporter=json",
        "--outputFile",
        jsonPath,
      ],
      { cwd: repoRoot, stdio: "inherit", env: process.env }
    );
    if (run.error) {
      console.error(`[test-gate] failed to run vitest: ${run.error.message}`);
      process.exit(1);
    }
    vitestStatus = run.status ?? 1;
  }

  if (!fs.existsSync(jsonPath)) {
    console.error(`[test-gate] vitest did not write ${jsonPath}`);
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  if (!report.numTotalTests) {
    console.error("[test-gate] vitest reported zero tests; refusing to pass");
    process.exit(1);
  }

  const failures = [];

  for (const file of report.testResults || []) {
    const relative = relativeTestFile(file.name);
    const failed = (file.assertionResults || []).filter((test) => test.status === "failed");
    if (failed.length) {
      for (const test of failed) {
        failures.push({
          key: `${relative} :: ${test.fullName}`,
          messages: test.failureMessages || [],
        });
      }
    } else if (file.status === "failed") {
      failures.push({
        key: `${relative} :: <suite failed to load>`,
        messages: file.message ? [file.message] : [],
      });
    }
  }

  const regressions = failures.filter((failure) => !expected.has(failure.key));
  const nowFailing = new Set(failures.map((failure) => failure.key));
  const fixed = [...expected].filter((key) => !nowFailing.has(key));

  if (vitestStatus !== 0 && failures.length === 0) {
    console.error("[test-gate] vitest exited nonzero without reporting a failed test");
    process.exit(1);
  }

  for (const failure of regressions) {
    console.error(`\n[test-gate] unexpected failure: ${failure.key}`);
    for (const message of failure.messages.slice(0, 3)) {
      console.error(message.split("\n").slice(0, 12).join("\n"));
    }
  }

  for (const key of fixed) {
    console.warn(`[test-gate] baseline is stale (now passes): ${key}`);
  }

  console.log(
    `\n[test-gate] failures=${failures.length} expected=${failures.length - regressions.length} ` +
      `regressions=${regressions.length} staleBaseline=${fixed.length}`
  );
  console.log(
    `[test-gate] baseline ${expected.size} tests in ${Object.keys(baseline.files || {}).length} files; ` +
      (vitestStatus === 0 ? "vitest passed" : "vitest exit absorbed by the known-red baseline")
  );

  if (regressions.length) process.exit(1);
} finally {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
}
