import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

describe("/v1/models custom-model capability overrides", () => {
  it("lets explicit custom caps win over the provider heuristic", async () => {
    db.getProviderConnections.mockResolvedValue([
      {
        id: "c1",
        provider: "commandcode",
        isActive: true,
        providerSpecificData: { enabledModels: ["totally-custom"] },
      },
    ]);
    db.getCustomModels.mockResolvedValue([
      {
        providerAlias: "cmc",
        id: "totally-custom",
        type: "llm",
        name: "Custom",
        caps: { vision: false, contextWindow: 32000, maxOutput: 4000 },
      },
    ]);

    const models = await buildModelsList(["llm"]);
    const model = models.find((entry) => entry.id === "cmc/totally-custom");

    expect(model).toBeDefined();
    expect(model.capabilities).toMatchObject({
      vision: false,
      contextWindow: 32000,
      maxOutput: 4000,
    });
    expect(model.context_length).toBe(32000);
    expect(model.max_completion_tokens).toBe(4000);
  });
});
