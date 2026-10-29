import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("combo credit fallback", () => {
  it.each([
    "You have insufficient credits to make this request.",
    "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    "Bad request",
  ])("advances past a 400 (%s) and serves the next member", async (message) => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["cmc/deepseek/deepseek-v4-pro", "mistral/mistral-medium-latest"];
    const failure = Response.json({ error: { message } }, { status: 400 });
    const success = Response.json({ choices: [{ message: { content: "Hello" } }] });
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(success);

    const response = await handleComboChat({
      body, models, handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "credit-fallback", comboStrategy: "fallback",
    });

    expect(response).toBe(success);
    expect(handleSingleModel.mock.calls).toEqual(models.map((model) => [body, model]));
  });

  it("returns the first request-scoped 4xx when no member can serve the request", async () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["cmc/deepseek/deepseek-v4-pro", "mistral/mistral-medium-latest"];
    const failure = Response.json({ error: { message: "Bad request" } }, { status: 400 });
    const handleSingleModel = vi.fn().mockResolvedValue(failure);

    const response = await handleComboChat({
      body, models, handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "credit-fallback", comboStrategy: "fallback",
    });

    // A request-scoped 4xx must surface the member's own response, not a
    // synthesized 200-with-error envelope.
    expect(response).toBe(failure);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });
});
