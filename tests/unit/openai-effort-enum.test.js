import { describe, expect, it } from "vitest";
import { applyThinking } from "open-sse/translator/concerns/thinkingUnified.js";

const apply = (model, effort, provider) => {
  const body = { reasoning_effort: effort };
  applyThinking("openai", model, body, provider);
  return body;
};

// The OpenAI wire forwards the client's level almost verbatim, so an arbitrary string
// used to reach the upstream as-is. Auditing all 5,136 (model, level) pairs showed
// `bogus` arriving at the wire on every OpenAI-format provider.
describe("OpenAI wire never echoes an unknown effort", () => {
  it.each(["bogus", "turbo", "HIGHEST"])("replaces %s with a known level", (effort) => {
    const body = apply("gpt-6-astra", effort, "codex");
    expect(["minimal", "low", "medium", "high", "xhigh", "max"]).toContain(body.reasoning_effort);
  });

  it("keeps every level the enum defines", () => {
    for (const effort of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
      expect(apply("gpt-6-astra", effort, "codex").reasoning_effort).toBe(effort);
    }
  });

  it("keeps the internal auto mode for the executor to resolve", () => {
    expect(apply("gpt-6-astra", "auto", "codex").reasoning_effort).toBe("auto");
  });

  it("still maps ultra to max", () => {
    expect(apply("gpt-6-astra", "ultra", "codex").reasoning_effort).toBe("max");
  });

  it("leaves a native-format provider's own scale untouched", () => {
    // siliconflow runs the zai wire, which speaks low|high|max, not the OpenAI enum.
    const body = { reasoning_effort: "high" };
    applyThinking("openai", "zai-org/GLM-5", body, "siliconflow");
    expect(body.reasoning_effort).toBe("high");
  });
});
