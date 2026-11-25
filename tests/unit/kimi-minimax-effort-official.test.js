import { describe, expect, it } from "vitest";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { applyThinking } from "open-sse/translator/concerns/thinkingUnified.js";

// Kimi K3/K3.1 Pro (platform.kimi.ai Model Parameter Reference): effort is low|high|max
// with max as default, and `thinking` is unsupported for the series.
describe("Kimi K3 effort matches the vendor enum", () => {
  it("advertises low/high/max only", () => {
    expect(getThinkingLevels("kimi", "kimi-k3")).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("gh", "kimi-k3")).toEqual(["low", "high", "max"]);
  });

  it("never sends medium, which the K3 series rejects", () => {
    for (const effort of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
      const body = { reasoning_effort: effort };
      applyThinking("openai", "kimi-k3", body, "kimi");
      expect(["low", "high", "max"]).toContain(body.reasoning_effort);
    }
  });

  it("keeps the wider set for models that publish it", () => {
    expect(getThinkingLevels("kimi", "kimi-k2.7-code-highspeed")).toEqual(["low", "medium", "high", "max"]);
  });
});

// MiniMax M3.1-Flash is the only M-series model with real depth tuning; plain M3
// ignores reasoning_effort and only switches thinking on/off.
describe("MiniMax effort matches the vendor enum", () => {
  it("gives M3.1-Flash the full scale", () => {
    expect(getThinkingLevels("minimax-code", "MiniMax-M3.1-Flash")).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("keeps M3 on the binary switch", () => {
    expect(getThinkingLevels("minimax-code", "MiniMax-M3")).toEqual(["none", "high"]);
  });
});

// Callers pass a provider id or its alias depending on the surface (models routes use
// the id, executors the alias). A provider-scoped level set must answer the same either
// way, and must not leak between two providers that share one short alias.
describe("provider id and alias agree", () => {
  it.each([
    ["minimax-code", "mm", "MiniMax-M3.1-Flash"],
    ["codex", "cx", "gpt-6-astra"],
    ["antigravity", "ag", "gemini-4-hydrogen"],
    ["kimi", "kimi", "kimi-k3"],
  ])("%s and %s agree", (id, alias, model) => {
    expect(getThinkingLevels(alias, model)).toEqual(getThinkingLevels(id, model));
  });

  it("does not leak one provider's set onto another", () => {
    // CodeBuddy CN publishes its own deepseek sets; DeepSeek's own enum must not reach it.
    expect(getThinkingLevels("cbcn", "deepseek-v4-pro")).toEqual(["low", "high", "xhigh"]);
    expect(getThinkingLevels("deepseek", "deepseek-v4-pro")).toEqual(["none", "low", "high", "max"]);
  });
});
