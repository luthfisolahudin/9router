import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

describe("Antigravity Claude Opus 4.6 (200k context & High thinking effort)", () => {
  it("resolves capabilities with 200k contextWindow and gemini-budget thinking format", () => {
    for (const provider of ["antigravity", "ag"]) {
      const caps = getCapabilitiesForModel(provider, "claude-opus-4-6-thinking");
      expect(caps.contextWindow).toBe(200000);
      expect(caps.maxOutput).toBe(64000);
      expect(caps.reasoning).toBe(true);
      expect(caps.thinkingFormat).toBe("gemini-budget");
      expect(caps.thinkingRange).toEqual({ min: 1024, max: 63999 });
    }
  });

  it("maps default claude-opus-4-6-thinking to high thinking effort upstream", () => {
    const upstream = getModelUpstreamId("antigravity", "claude-opus-4-6-thinking");
    expect(upstream).toBe("claude-opus-4-6-thinking(high)");
  });

  it("preserves explicit effort override when provided", () => {
    const upstream = getModelUpstreamId("antigravity", "claude-opus-4-6-thinking(max)");
    expect(upstream).toBe("claude-opus-4-6-thinking(max)");
  });

  it("translates OpenAI request to Antigravity envelope with High thinking budget and output buffer", () => {
    const upstream = getModelUpstreamId("antigravity", "claude-opus-4-6-thinking");
    const body = {
      messages: [{ role: "user", content: "Write a complex refactor" }],
    };
    const credentials = { projectId: "test-project", connectionId: "conn-1" };
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      upstream,
      body,
      true,
      credentials,
      "antigravity"
    );

    expect(translated.model).toBe("claude-opus-4-6-thinking(high)");
    expect(translated.userAgent).toBe("antigravity");
    expect(translated.requestType).toBe("agent");

    const genConfig = translated.request.generationConfig;
    expect(genConfig.maxOutputTokens).toBe(64000);
    expect(genConfig.thinkingConfig).toEqual({
      thinkingBudget: 24576,
      includeThoughts: true,
    });
  });

  it("clamps max thinking budget so maxOutputTokens > thinkingBudget", () => {
    const upstream = getModelUpstreamId("antigravity", "claude-opus-4-6-thinking(max)");
    const body = {
      messages: [{ role: "user", content: "Solve hard task" }],
    };
    const credentials = { projectId: "test-project", connectionId: "conn-1" };
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      upstream,
      body,
      true,
      credentials,
      "antigravity"
    );

    const genConfig = translated.request.generationConfig;
    expect(genConfig.maxOutputTokens).toBe(64000);
    expect(genConfig.thinkingConfig.thinkingBudget).toBeLessThanOrEqual(63999);
    expect(genConfig.thinkingConfig.thinkingBudget).toBeGreaterThan(0);
    expect(genConfig.maxOutputTokens).toBeGreaterThan(genConfig.thinkingConfig.thinkingBudget);
  });

  it("preserves generationConfig.thinkingConfig in AntigravityExecutor and strips top-level thinking fields", () => {
    const ag = new AntigravityExecutor();
    const upstream = getModelUpstreamId("antigravity", "claude-opus-4-6-thinking");
    const body = {
      messages: [{ role: "user", content: "Write code" }],
    };
    const credentials = { projectId: "test-project", connectionId: "conn-1" };
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      upstream,
      body,
      true,
      credentials,
      "antigravity"
    );

    const executed = ag.transformRequest("claude-opus-4-6-thinking", translated, true, credentials);
    expect(executed.request.generationConfig.thinkingConfig).toEqual({
      thinkingBudget: 24576,
      includeThoughts: true,
    });
    expect(executed.request.generationConfig.maxOutputTokens).toBe(64000);
    expect(executed).not.toHaveProperty("thinking");
    expect(executed).not.toHaveProperty("output_config");
    expect(executed).not.toHaveProperty("reasoning_effort");
  });
});
