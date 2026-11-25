import { describe, it } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { PROVIDER_MODELS, getSelectableModels } from "open-sse/config/providerModels.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

describe("audit export", () => {
  it("dumps", () => {
    const ours = [];
    for (const alias of Object.keys(PROVIDER_MODELS)) {
      for (const m of getSelectableModels(alias)) {
        const caps = getCapabilitiesForModel(alias, m.id);
        ours.push({
          provider: alias,
          id: m.id,
          reasoning: caps.reasoning === true,
          fmt: caps.thinkingFormat ?? null,
          ctx: caps.contextWindow ?? null,
          out: caps.maxOutput ?? null,
          vision: caps.vision === true,
          levels: getThinkingLevels(alias, m.id) ?? null,
        });
      }
    }
    writeFileSync("/tmp/opencode/ours.json", JSON.stringify(ours));
    console.log("OURS " + ours.length);
  });
});
