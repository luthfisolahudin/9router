import { describe, it } from "vitest";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { applyThinking } from "open-sse/translator/concerns/thinkingUnified.js";

// DeepSeek's own API (api-docs.deepseek.com Chat Completions) accepts
// none|low|high|max and maps medium/xhigh to high. Offering only {high,max}
// made the cheap `low` tier unreachable through the picker.
describe("DeepSeek effort matches the vendor enum", () => {
  it("offers low on DeepSeek's own provider", () => {
    expect(getThinkingLevels("deepseek", "deepseek-v4-pro")).toEqual(["none", "low", "high", "max"]);
    expect(getThinkingLevels("deepseek", "deepseek-v4.1-flash")).toEqual(["none", "low", "high", "max"]);
  });

  it("forwards low verbatim instead of upgrading it to high", () => {
    const body = { reasoning_effort: "low" };
    applyThinking("openai", "deepseek-v4-pro", body, "deepseek");
    expect(body.reasoning_effort).toBe("low");
  });

  it("maps medium to high, as the vendor documents", () => {
    const body = { reasoning_effort: "medium" };
    applyThinking("openai", "deepseek-v4-pro", body, "deepseek");
    expect(body.reasoning_effort).toBe("high");
  });

  it("keeps a gateway that publishes its own set untouched", () => {
    // CodeBuddy CN publishes only high|max; low must still collapse there.
    expect(getThinkingLevels("cbcn", "deepseek-v4-pro")).toEqual(["none", "high", "max"]);
  });
});
