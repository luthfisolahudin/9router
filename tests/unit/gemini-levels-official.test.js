import { describe, it } from "vitest";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { applyThinking } from "open-sse/translator/concerns/thinkingUnified.js";

// Official per-model level sets (docs.cloud.google.com Gemini thinking,
// aistudio.google.com/docs/thinking). "minimal" on 3.8/3.7 Flash, 3.1 Pro or 3 Pro
// is a documented 400 INVALID_ARGUMENT, so it must never reach the wire.
const EXPECTED = {
  "gemini-3.8-flash": ["low", "medium", "high"],
  "gemini-3.7-flash": ["low", "medium", "high"],
  "gemini-3.6-flash": ["minimal", "low", "medium", "high"],
  "gemini-3.1-pro-preview": ["low", "medium", "high"],
  "gemini-3-flash-preview": ["minimal", "low", "medium", "high"],
  "gemini-3-pro-preview": ["low", "high"],
  "gemini-4-hydrogen": ["low", "medium", "high", "xhigh"],
  "gemini-4-argon": ["low", "medium", "high"],
  "gemini-4-carbon": ["low", "medium", "high"],
};

describe("Gemini level sets match Google's per-model table", () => {
  it.each(Object.entries(EXPECTED))("%s offers exactly its documented levels", (model, levels) => {
    expect(getThinkingLevels("gemini", model)).toEqual(levels);
  });

  it("never sends a level the model rejects", () => {
    for (const [model, levels] of Object.entries(EXPECTED)) {
      for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
        const body = { reasoning_effort: effort };
        applyThinking("gemini", model, body, "gemini");
        const sent = body.generationConfig?.thinkingConfig?.thinkingLevel;
        expect(levels, `${model} + ${effort} sent ${sent}`).toContain(sent);
      }
    }
  });
});
