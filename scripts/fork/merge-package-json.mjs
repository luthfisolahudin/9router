import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Three-way package.json merge for the sync automation. The fork deliberately
// keeps newer dependency ranges; this resolver makes that divergence mechanical
// instead of a human conflict. Higher semver wins in dependency maps; fork-only
// fields and fork-edited scripts stay.

const DEPENDENCY_SECTIONS = new Set([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
  "resolutions",
]);

const FORK_OWNED_KEYS = new Set(["devEngines"]);

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function parseVersion(spec) {
  if (typeof spec !== "string") return null;
  const match = spec.match(/(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] || "",
  };
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] - b.parts[i];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function pickHigherSpec(ours, theirs, label, decisions) {
  const a = parseVersion(ours);
  const b = parseVersion(theirs);
  if (a && b) {
    const order = compareVersions(a, b);
    if (order > 0) {
      decisions.push(`${label}: kept fork ${ours} over upstream ${theirs}`);
      return ours;
    }
    if (order < 0) {
      decisions.push(`${label}: took upstream ${theirs} over fork ${ours}`);
      return theirs;
    }
    return ours;
  }
  if (a) {
    decisions.push(`${label}: kept parseable fork range ${ours}`);
    return ours;
  }
  if (b) {
    decisions.push(`${label}: took parseable upstream range ${theirs}`);
    return theirs;
  }
  decisions.push(`${label}: kept fork value ${JSON.stringify(ours)}`);
  return ours;
}

function mergeValue(base, ours, theirs, pathParts, decisions) {
  if (equal(ours, theirs)) return ours;
  if (equal(ours, base)) return theirs;
  if (equal(theirs, base)) return ours;

  if (isObject(ours) && isObject(theirs)) {
    return mergeObject(isObject(base) ? base : {}, ours, theirs, pathParts, decisions);
  }

  const section = pathParts[0];
  if (pathParts.length === 2 && DEPENDENCY_SECTIONS.has(section)) {
    return pickHigherSpec(ours, theirs, pathParts.join("."), decisions);
  }
  if (section === "version") {
    decisions.push(`version: took upstream ${theirs} over fork ${ours}`);
    return theirs;
  }
  if (FORK_OWNED_KEYS.has(section) || section === "scripts") {
    decisions.push(`${pathParts.join(".")}: kept fork value`);
    return ours;
  }
  decisions.push(`${pathParts.join(".")}: took upstream value`);
  return theirs;
}

function mergeObject(base, ours, theirs, pathParts, decisions) {
  const result = {};
  const keys = [...new Set([...Object.keys(ours), ...Object.keys(theirs)])];

  for (const key of keys) {
    const label = [...pathParts, key].join(".");
    const baseHas = has(base, key);
    const oursHas = has(ours, key);
    const theirsHas = has(theirs, key);
    const baseValue = baseHas ? base[key] : undefined;
    const oursValue = oursHas ? ours[key] : undefined;
    const theirsValue = theirsHas ? theirs[key] : undefined;

    if (!oursHas) {
      if (!theirsHas) continue;
      if (!baseHas || !equal(theirsValue, baseValue)) {
        if (baseHas) decisions.push(`${label}: fork deleted, upstream changed; took upstream`);
        result[key] = theirsValue;
      }
      continue;
    }

    if (!theirsHas) {
      if (baseHas && equal(oursValue, baseValue)) continue;
      decisions.push(
        baseHas
          ? `${label}: upstream deleted, fork changed; kept fork`
          : `${label}: kept fork-only field`
      );
      result[key] = oursValue;
      continue;
    }

    if (!baseHas) {
      if (equal(oursValue, theirsValue)) {
        result[key] = oursValue;
        continue;
      }
      result[key] = mergeValue(undefined, oursValue, theirsValue, [...pathParts, key], decisions);
      continue;
    }

    result[key] = mergeValue(baseValue, oursValue, theirsValue, [...pathParts, key], decisions);
  }

  return result;
}

export function mergePackageJson(base, ours, theirs) {
  for (const [name, value] of Object.entries({ base, ours, theirs })) {
    if (!isObject(value)) throw new Error(`${name} package.json must be an object`);
  }
  const decisions = [];
  const json = mergeObject(base, ours, theirs, [], decisions);
  return { json, decisions };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
  const [basePath, oursPath, theirsPath, outputPath] = process.argv.slice(2);
  if (!basePath || !oursPath || !theirsPath) {
    console.error("usage: merge-package-json.mjs <base> <ours> <theirs> [output]");
    process.exit(2);
  }

  try {
    const { json, decisions } = mergePackageJson(
      readJson(basePath),
      readJson(oursPath),
      readJson(theirsPath)
    );
    const destination = outputPath || oursPath;
    fs.writeFileSync(destination, `${JSON.stringify(json, null, 2)}\n`);
    for (const decision of decisions) console.error(`[package-json-merge] ${decision}`);
    console.log(`[package-json-merge] wrote ${destination} (${decisions.length} decisions)`);
  } catch (error) {
    console.error(`[package-json-merge] ${error.message}`);
    process.exit(2);
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) main();
