import { describe, expect, it } from "vitest";
import { createRequire } from "module";

import {
  getProviderModels,
  getSelectableModels,
  getModelUpstreamId,
} from "../../open-sse/config/providerModels.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

const require = createRequire(import.meta.url);
const { tierBaseId } = require("../../src/mitm/config.js");

// A tier preset is the same model at a fixed effort. Pickers offer the bare id and
// drive effort through reasoning_effort; every tier id still resolves so a client
// or stored alias naming one keeps working.
describe("Antigravity effort tiers are presets, not separate models", () => {
  it("offers one entry per family", () => {
    const selectable = getSelectableModels("ag");
    const ids = selectable.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([
      "gemini-4-hydrogen",
      "gemini-4-carbon",
      "gemini-4-argon",
      "gemini-4-neon",
      "gemini-3.8-flash",
      "claude-sonnet-5-5",
      "claude-opus-5-5",
    ]));
    // No tier preset leaks into a picker. Asserted on the declared tier, not the
    // name: "-medium" also ends real ids such as gpt-oss-120b-medium.
    expect(selectable.filter((m) => m.tier)).toEqual([]);
  });

  it("keeps every tier id resolvable and registered", () => {
    const all = getProviderModels("ag").map((m) => m.id);
    for (const id of ["gemini-4-neon-low", "gemini-4-neon-xhigh", "claude-opus-5-5-max"]) {
      expect(all).toContain(id);
      expect(getModelUpstreamId("ag", id, {})).toContain(`(${id.slice(id.lastIndexOf("-") + 1)})`);
    }
  });

  it("routes a bare id to the tier its effort asks for", () => {
    expect(getModelUpstreamId("ag", "gemini-4-neon", { reasoning_effort: "low" })).toBe("gemini-4-neon-low(low)");
    expect(getModelUpstreamId("ag", "gemini-4-neon", { reasoning_effort: "xhigh" })).toBe("gemini-4-neon-xhigh(xhigh)");
    expect(getModelUpstreamId("ag", "claude-sonnet-5-5", { reasoning_effort: "max" })).toBe("claude-sonnet-5-5-max(max)");
    // A level the family does not serve collapses to its highest tier.
    expect(getModelUpstreamId("ag", "gemini-4-carbon", { reasoning_effort: "xhigh" })).toBe("gemini-4-carbon-high(high)");
  });

  it("advertises a tier id's own level instead of the whole family's", () => {
    expect(getThinkingLevels("antigravity", "gemini-4-neon")).toEqual(["low", "medium", "high", "xhigh"]);
    expect(getThinkingLevels("antigravity", "gemini-4-neon-low")).toEqual(["low"]);
    expect(getThinkingLevels("antigravity", "gemini-4-carbon-high")).toEqual(["high"]);
    expect(getThinkingLevels("antigravity", "claude-opus-5-5-max")).toEqual(["max"]);
  });

  it("maps one MITM slot per family", () => {
    const ids = MITM_TOOLS.antigravity.defaultModels.map((m) => m.id);
    // Tier presets are not separate mapping slots; names ending in "-medium" that
    // are real models (gpt-oss-120b-medium) keep theirs.
    expect(ids).toContain("gpt-oss-120b-medium");
    expect(ids.filter((id) => /^gemini-\d*(\.\d+)?-(flash|pro|neon|carbon|argon|hydrogen)-/.test(id))).toEqual([]);
    expect(MITM_TOOLS.antigravity.defaultModels.find((m) => m.id === "gemini-3.8-flash")?.mandatory).toBe(true);
  });
});

describe("MITM collapses a tier alias when the IDE states its effort", () => {
  const aliases = {
    "gemini-4-neon": "ag/gemini-4-neon",
    "gemini-4-neon-high": "ag/gemini-4-neon-high",
    "gpt-oss-120b-medium": "ag/gpt-oss-120b-medium",
  };

  it("collapses only registered tier presets", () => {
    expect(tierBaseId("antigravity", "gemini-4-neon-high", aliases)).toBe("gemini-4-neon");
    // A bare id is already the family entry.
    expect(tierBaseId("antigravity", "gemini-4-neon", aliases)).toBeNull();
    // "-medium" is part of this model's name, not a tier: it has no bare entry.
    expect(tierBaseId("antigravity", "gpt-oss-120b-medium", aliases)).toBeNull();
    // Tier id known but its family entry missing: leave the alias alone.
    expect(tierBaseId("antigravity", "gemini-4-argon-low", aliases)).toBeNull();
  });
});
