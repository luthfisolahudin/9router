import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel, setCatalogSource } from "open-sse/providers/capabilities.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";

// Embedding and TTS ids inherit chat patterns by name, so a picker used to offer
// reasoning levels on an endpoint that only returns vectors or audio, and a 1M
// context window that belongs to the chat family.
describe("non-chat models do not inherit chat capabilities", () => {
  it.each([
    ["nebius", "Qwen/Qwen3-Embedding-8B"],
    ["openrouter", "qwen/qwen3-embedding-8b"],
    ["gemini", "gemini-2.5-flash-preview-tts"],
    ["gemini", "gemini-embedding-001"],
    ["gemini-tts-models", "gemini-2.5-pro-preview-tts"],
  ])("%s/%s declares no reasoning or effort menu", (provider, model) => {
    const caps = getCapabilitiesForModel(provider, model);
    expect(caps.reasoning).toBe(false);
    expect(caps.thinkingFormat).toBeNull();
    expect(getThinkingLevels(provider, model)).toBeNull();
  });

  it("does not claim the chat family's 1M window for a TTS or embedding id", () => {
    expect(getCapabilitiesForModel("gemini", "gemini-2.5-flash-preview-tts").contextWindow).toBeNull();
    expect(getCapabilitiesForModel("gemini", "gemini-embedding-001").contextWindow).toBeNull();
  });

  it("still reports the real limits when the synced catalog knows them", () => {
    setCatalogSource({
      getModalities: () => null,
      getLimits: (provider, model) =>
        provider === "gemini" && model === "gemini-embedding-001" ? { contextWindow: 2048, maxOutput: 1 } : null,
    });
    try {
      const caps = getCapabilitiesForModel("gemini", "gemini-embedding-001");
      expect(caps.contextWindow).toBe(2048);
      expect(caps.maxOutput).toBe(1);
      expect(caps.reasoning).toBe(false);
    } finally {
      setCatalogSource(null);
    }
  });

  it("leaves chat models on the family entry", () => {
    const prose = getCapabilitiesForModel("gemini", "gemini-2.5-pro");
    expect(prose.reasoning).toBe(true);
    expect(prose.contextWindow).toBe(1048576);

    const embeddingNamedChat = getCapabilitiesForModel("oc", "qwen3-coder");
    expect(embeddingNamedChat.reasoning).toBe(true);
  });
});
