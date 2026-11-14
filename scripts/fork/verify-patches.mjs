import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Verify every behavior patch in scripts/fork/patches.json still has its files,
// markers, and focused tests. Run after each upstream sync and in release CI.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(repoRoot, "scripts/fork/patches.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const runTests = process.argv.includes("--run");

let failures = 0;
const testFiles = new Set();

for (const patch of manifest.patches) {
  const problems = [];
  const sources = new Map();

  for (const file of patch.files || []) {
    const absolute = path.join(repoRoot, file);
    if (!fs.existsSync(absolute)) {
      problems.push(`missing file ${file}`);
      continue;
    }
    sources.set(file, fs.readFileSync(absolute, "utf8"));
  }

  for (const marker of patch.markers || []) {
    const found = [...sources.values()].some((source) => source.includes(marker));
    if (!found) problems.push(`missing marker ${JSON.stringify(marker)}`);
  }

  if (!patch.tests || patch.tests.length === 0) {
    if (!patch.manual) problems.push("no tests and no manual verification note");
  }
  for (const test of patch.tests || []) {
    if (!fs.existsSync(path.join(repoRoot, test))) {
      problems.push(`missing test ${test}`);
    } else {
      testFiles.add(test.replace(/^tests\//, ""));
    }
  }

  if (problems.length) {
    failures += 1;
    console.error(`[fail] ${patch.id} — ${patch.summary}`);
    for (const problem of problems) console.error(`       ${problem}`);
  } else if (patch.tests?.length) {
    console.log(`[ok]   ${patch.id} — ${patch.tests.length} focused test file(s)`);
  } else {
    console.log(`[ok]   ${patch.id} — marker-only (${patch.manual})`);
  }
}

if (failures) {
  console.error(`\n${failures} fork patch(es) failed verification.`);
  process.exit(1);
}

console.log(`\n${manifest.patches.length} fork patches verified.`);

if (runTests) {
  const result = spawnSync(
    "pnpm",
    ["-C", "tests", "exec", "vitest", "run", ...[...testFiles]],
    { cwd: repoRoot, stdio: "inherit", env: process.env }
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
