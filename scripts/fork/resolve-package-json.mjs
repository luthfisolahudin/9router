import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { mergePackageJson } from "./merge-package-json.mjs";

// Resolve an in-progress merge/rebase conflict for package.json using the
// three-way rule in merge-package-json.mjs, then stage the result. Git inverts
// "ours"/"theirs" during a rebase, so read the index stages accordingly.

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function gitDir() {
  return path.resolve(git(["rev-parse", "--git-dir"]).trim());
}

function isRebase() {
  const dir = gitDir();
  return (
    fs.existsSync(path.join(dir, "rebase-merge")) ||
    fs.existsSync(path.join(dir, "rebase-apply"))
  );
}

function readStage(stage) {
  try {
    return JSON.parse(git(["show", `:${stage}:package.json`]));
  } catch {
    return null;
  }
}

function main() {
  const unmerged = git(["ls-files", "-u", "--", "package.json"]).trim();
  if (!unmerged) {
    console.error("[resolve-package-json] package.json has no conflict stages");
    process.exit(1);
  }

  const stage2 = readStage(2);
  const stage3 = readStage(3);
  if (!stage2 && !stage3) {
    console.error("[resolve-package-json] package.json has no usable conflict stages");
    process.exit(1);
  }

  const rebase = isRebase();
  const ours = rebase ? stage3 || stage2 : stage2 || stage3;
  const theirs = rebase ? stage2 || stage3 : stage3 || stage2;
  const base = readStage(1) || {};

  try {
    const { json, decisions } = mergePackageJson(base, ours, theirs);
    const root = git(["rev-parse", "--show-toplevel"]).trim();
    const target = path.join(root, "package.json");
    fs.writeFileSync(target, `${JSON.stringify(json, null, 2)}\n`);
    git(["add", "--", "package.json"]);
    for (const decision of decisions) console.error(`[resolve-package-json] ${decision}`);
    console.log(
      `[resolve-package-json] resolved package.json (${rebase ? "rebase" : "merge"} stages, ${decisions.length} decisions)`
    );
  } catch (error) {
    console.error(`[resolve-package-json] ${error.message}`);
    process.exit(2);
  }
}

main();
