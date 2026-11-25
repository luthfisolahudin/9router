import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getSelectableModels, getModelUpstreamId } from "open-sse/config/providerModels.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { stripThinkingSuffix } from "open-sse/translator/concerns/thinkingUnified.js";
import { translateRequest } from "open-sse/translator/index.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { getExecutor } from "open-sse/executors/index.js";

// Walks the same chain a real request does — client model id, upstream id resolution,
// translation, executor transform — for every model that advertises an effort level.
// Cursor is excluded: its executor encodes effort into a protobuf frame rather than a
// JSON field, so a JSON-shape assertion cannot see it (covered by its own executor tests).
const JSON_WIRE_SKIP = new Set(["cu", "cursor", "kr", "kiro"]);
const SOURCE_FORMATS = [FORMATS.OPENAI, FORMATS.CLAUDE, FORMATS.GEMINI];

function clientBodyFor(sourceFormat, model, level) {
  const body = {
    model,
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 1024,
    stream: false,
  };
  if (sourceFormat === FORMATS.CLAUDE) body.thinking = { type: "enabled", budget_tokens: 8192 };
  else if (sourceFormat === FORMATS.GEMINI) body.generationConfig = { thinkingConfig: { thinkingLevel: level } };
  else body.reasoning_effort = level;
  return body;
}

function hasEffortField(wire) {
  const tc = wire?.request?.generationConfig?.thinkingConfig || wire?.generationConfig?.thinkingConfig;
  return Boolean(
    wire?.reasoning_effort || wire?.thinking || wire?.output_config || wire?.enable_thinking ||
    wire?.params?.reasoning_effort || wire?.reasoning || tc,
  );
}

describe("every advertised effort survives translation and the executor", () => {
  it("reaches the executor body for every model and source format", () => {    const failures = [];
    let checked = 0;

    for (const alias of Object.keys(PROVIDER_MODELS)) {
      if (JSON_WIRE_SKIP.has(alias)) continue;
      for (const m of getSelectableModels(alias)) {
        const levels = getThinkingLevels(alias, m.id);
        if (!levels) continue;
        const level = levels.find((l) => l !== "none" && l !== "thinking");
        if (!level) continue;

        for (const sourceFormat of SOURCE_FORMATS) {
          const clientBody = clientBodyFor(sourceFormat, m.id, level);
          const upstream = getModelUpstreamId(alias, m.id, clientBody);
          const translated = translateRequest(
            sourceFormat, FORMATS.ANTIGRAVITY, upstream, structuredClone(clientBody),
            false, { accessToken: "x", projectId: "p", connectionId: "c" }, alias, null, [], "c", "audit",
          );
          if (!translated) {
            failures.push(`${alias}/${m.id} ${sourceFormat}: translator returned null`);
            continue;
          }
          translated.model = stripThinkingSuffix(upstream);
          const wire = getExecutor(alias).transformRequest(
            translated.model, translated, false, { projectId: "p", connectionId: "c" },
          );
          checked++;
          if (!hasEffortField(wire)) {
            failures.push(`${alias}/${m.id} ${sourceFormat}: no effort field on the wire`);
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(2000);
    expect(failures.slice(0, 20)).toEqual([]);
  }, 120_000);
});
