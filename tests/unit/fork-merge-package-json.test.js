import { describe, expect, it } from "vitest";
import { mergePackageJson } from "../../scripts/fork/merge-package-json.mjs";

const pkg = (value) => ({ name: "9router", version: "0.5.100", ...value });

describe("fork package.json merge", () => {
  it("returns the base when neither side changed", () => {
    const base = pkg({ dependencies: { next: "^16.4.0" } });
    expect(mergePackageJson(base, base, base).json).toEqual(base);
  });

  it("keeps a fork-only dependency bump", () => {
    const base = pkg({ dependencies: { next: "^16.4.0" } });
    const ours = pkg({ dependencies: { next: "^16.4.5" } });
    expect(mergePackageJson(base, ours, base).json.dependencies.next).toBe("^16.4.5");
  });

  it("takes an upstream-only dependency bump", () => {
    const base = pkg({ dependencies: { next: "^16.4.0" } });
    const theirs = pkg({ dependencies: { next: "^16.5.0" } });
    expect(mergePackageJson(base, base, theirs).json.dependencies.next).toBe("^16.5.0");
  });

  it("picks the higher semver when both sides bumped the same dependency", () => {
    const base = pkg({ dependencies: { next: "^16.4.0" } });
    const ours = pkg({ dependencies: { next: "^16.4.5" } });
    const theirs = pkg({ dependencies: { next: "^16.5.0" } });

    expect(mergePackageJson(base, ours, theirs).json.dependencies.next).toBe("^16.5.0");
    expect(mergePackageJson(base, theirs, ours).json.dependencies.next).toBe("^16.5.0");
  });

  it("orders prereleases below the stable release", () => {
    const base = pkg({ dependencies: { lib: "^1.0.0" } });
    const ours = pkg({ dependencies: { lib: "1.1.0-beta.1" } });
    const theirs = pkg({ dependencies: { lib: "1.1.0" } });
    expect(mergePackageJson(base, ours, theirs).json.dependencies.lib).toBe("1.1.0");
  });

  it("keeps fork-only devEngines and fork-edited scripts", () => {
    const base = pkg({ scripts: { build: "next build", "cli:pack": "npm -C cli run pack" } });
    const ours = pkg({
      devEngines: { packageManager: { name: "pnpm", version: "12.20.0" } },
      scripts: { build: "next build", "cli:pack": "pnpm -C cli run pack" },
    });
    const theirs = pkg({
      scripts: { build: "next build --webpack", "cli:pack": "npm -C cli run pack", test: "vitest" },
    });

    const merged = mergePackageJson(base, ours, theirs).json;
    expect(merged.devEngines.packageManager.name).toBe("pnpm");
    expect(merged.scripts["cli:pack"]).toBe("pnpm -C cli run pack");
    expect(merged.scripts.build).toBe("next build --webpack");
    expect(merged.scripts.test).toBe("vitest");
  });

  it("takes the upstream version field", () => {
    const base = pkg({});
    const ours = pkg({});
    const theirs = { ...pkg({}), version: "0.5.119" };
    expect(mergePackageJson(base, ours, theirs).json.version).toBe("0.5.119");
  });

  it("keeps the fork range when neither side parses as a version", () => {
    const base = pkg({ dependencies: { lib: "latest" } });
    const ours = pkg({ dependencies: { lib: "workspace:*" } });
    const theirs = pkg({ dependencies: { lib: "next" } });
    expect(mergePackageJson(base, ours, theirs).json.dependencies.lib).toBe("workspace:*");
  });

  it("takes an upstream edit to a field the fork deleted", () => {
    const base = pkg({ custom: { a: 1 } });
    const ours = { name: "9router", version: "0.5.100" };
    const theirs = { ...base, custom: { a: 2 } };
    expect(mergePackageJson(base, ours, theirs).json.custom).toEqual({ a: 2 });
  });

  it("honors a fork deletion when upstream left the field alone", () => {
    const base = pkg({ custom: { a: 1 } });
    const ours = { name: "9router", version: "0.5.100" };
    expect(mergePackageJson(base, ours, base).json.custom).toBeUndefined();
  });

  it("rejects non-object inputs", () => {
    expect(() => mergePackageJson(null, {}, {})).toThrow(/base package.json/);
  });
});
