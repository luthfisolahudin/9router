import { describe, expect, it } from "vitest";

import { translateRequest } from "open-sse/translator/index.js";
import AntigravityExecutor from "open-sse/executors/antigravity.js";
import { stripThinkingSuffix } from "open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "open-sse/translator/formats.js";

const executor = new AntigravityExecutor();

// The Antigravity IDE states its effort in generationConfig.thinkingConfig. The MITM
// handler forwards that body, so whatever the router builds from it is what upstream
// sees. reading only thinkingBudget dropped thinkingLevel entirely.
function wireFrom(upstreamModel, thinkingConfig) {
  const body = {
    model: upstreamModel,
    project: "p",
    request: {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: thinkingConfig ? { thinkingConfig } : {},
    },
  };
  const translated = translateRequest(
    FORMATS.ANTIGRAVITY,
    FORMATS.ANTIGRAVITY,
    upstreamModel,
    structuredClone(body),
    true,
    { accessToken: "x" },
    "antigravity",
    null,
    [],
    "connection",
    "antigravity",
  );
  translated.model = stripThinkingSuffix(upstreamModel);
  return executor.transformRequest(translated.model, translated, true, { projectId: "p", connectionId: "connection" });
}

describe("Antigravity MITM keeps the IDE's thinking level", () => {
  it.each([
    ["low"],
    ["medium"],
    ["high"],
    ["xhigh"],
  ])("forwards thinkingLevel %s instead of dropping it", (level) => {
    const wire = wireFrom("gemini-4-neon", { thinkingLevel: level, includeThoughts: true });
    expect(wire.request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: level, includeThoughts: true });
  });

  it("still maps a legacy numeric thinkingBudget", () => {
    const wire = wireFrom("gemini-4-neon", { thinkingBudget: 2048, includeThoughts: true });
    expect(wire.request.generationConfig.thinkingConfig.thinkingLevel).toBe("low");
  });

  it("leaves a body with no thinking config to the model default", () => {
    const wire = wireFrom("gemini-4-neon", null);
    expect(wire.request.generationConfig.thinkingConfig).toBeUndefined();
  });
});
