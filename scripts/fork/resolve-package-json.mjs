import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { mergePackageJson } from "./merge-package-json.mjs";

// Resolve in-progress merge/rebase conflicts for every conflicted workspace
// manifest using the three-way rule in merge-package-json.mjs, then stage each
// result. Git inverts "ours"/"theirs" during a rebase, so read the index stages
// accordingly. Paths may be passed explicitly; defaults to every unmerged
// package.json (root, cli, tests).

const MANIFEST_NAME = "package.json";

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

function conflictedManifests() {
  const out = git(["ls-files", "-u", "-z", "--", `*${MANIFEST_NAME}`]);
  const paths = new Set();
  for (const entry of out.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab >= 0) paths.add(entry.slice(tab + 1));
  }
  return [...paths].sort();
}

function readStage(stage, manifest) {
  try {
    return JSON.parse(git(["show", `:${stage}:${manifest}`]));
  } catch {
    return null;
  }
}

function resolveManifest(manifest, rebase) {
  const stage2 = readStage(2, manifest);
  const stage3 = readStage(3, manifest);
  if (!stage2 && !stage3) return { manifest, error: "no usable conflict stages" };

  const ours = rebase ? stage3 || stage2 : stage2 || stage3;
  const theirs = rebase ? stage2 || stage3 : stage3 || stage2;
  const base = readStage(1, manifest) || {};

  const { json, decisions } = mergePackageJson(base, ours, theirs);
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  fs.writeFileSync(path.join(root, manifest), `${JSON.stringify(json, null, 2)}\n`);
  git(["add", "--", manifest]);
  return { manifest, decisions };
}

function main() {
  const explicit = process.argv.slice(2);
  const manifests = explicit.length ? explicit : conflictedManifests();

  if (!manifests.length) {
    console.error("[resolve-package-json] no conflicted package.json to resolve");
    process.exit(1);
  }

  const rebase = isRebase();
  let resolved = 0;
  for (const manifest of manifests) {
    try {
      const { decisions, error } = resolveManifest(manifest, rebase);
      if (error) {
        console.error(`[resolve-package-json] ${manifest}: ${error}`);
        continue;
      }
      for (const decision of decisions) {
        console.error(`[resolve-package-json] ${manifest}: ${decision}`);
      }
      console.log(
        `[resolve-package-json] resolved ${manifest} (${rebase ? "rebase" : "merge"} stages, ${decisions.length} decisions)`
      );
      resolved += 1;
    } catch (error) {
      console.error(`[resolve-package-json] ${manifest}: ${error.message}`);
    }
  }

  if (!resolved) process.exit(2);
}

main();
