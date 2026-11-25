import { describe, it } from "vitest";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";

// Alibaba Model Studio (docs.qwencloud.com): the Qwen 3.8 family serves
// low|medium|xhigh with xhigh as the default. The generic `qwen` format set tops
// out at `high`, so without a provider-scoped entry the model's best level was
// unreachable through the picker.
describe("Qwen 3.8 effort matches Model Studio", () => {
  it.each(["alitp-intl", "qwencloud"])("offers low/medium/xhigh on %s", (provider) => {
    expect(getThinkingLevels(provider, "qwen3.8-max")).toEqual(["none", "low", "medium", "xhigh"]);
    expect(getThinkingLevels(provider, "qwen3.8-max-preview")).toEqual(["none", "low", "medium", "xhigh"]);
  });

  it("keeps the reachable top tier as xhigh, not high", () => {
    const levels = getThinkingLevels("alitp-intl", "qwen3.8-max");
    expect(levels.at(-1)).toBe("xhigh");
    expect(levels).not.toContain("high");
  });

  it("leaves other Qwen hosting on the generic set", () => {
    expect(getThinkingLevels("oc", "qwen3-coder")).toEqual(["none", "low", "medium", "high"]);
  });
});
