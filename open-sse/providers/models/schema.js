import { deriveModelName } from "./namePatterns.js";

// Normalize version separators in a model id: hyphen between two digits becomes a dot.
// Registry ids use dots for versions ("claude-sonnet-4.5") but clients (CLIs, aliases)
// often send them with dashes ("claude-sonnet-4-5"). Only digit-digit hyphens are
// touched, so word/suffix hyphens stay intact ("-thinking", "-agentic", "qwen3-coder-next").
export function normalizeModelId(modelId) {
  if (typeof modelId !== "string") return modelId;
  return modelId.replace(/(\d)-(\d)/g, "$1.$2");
}

// Model defaults centralized (was scattered as `m.kind || "llm"`, `quotaFamily || "normal"`, etc.)
export const MODEL_DEFAULTS = {
  kind: "llm",
  quotaFamily: "normal",
  strip: [],
  targetFormat: null
};

// Normalize a registry model entry: accept terse "id" string, fill name via regex when omitted.
// Override always wins (raw spread last); name falls back to regex → id.
export function normalizeModel(raw) {
  const model = typeof raw === "string" ? { id: raw } : raw;
  if (model.name !== undefined) return model;
  return { ...model, name: deriveModelName(model.id) };
}

// Resolve model kind with default (accepts legacy `type` field)
export function modelKind(model) {
  return model?.kind || model?.type || MODEL_DEFAULTS.kind;
}
// Extra request parameters a model declares (e.g. ["input_type"]). Explicit opt-in
// only — an absent list means the model takes no extra params.
export function modelParams(model) {
  return Array.isArray(model?.params) ? model.params : [];
}
export function modelQuotaFamily(model) {
  return model?.quotaFamily || MODEL_DEFAULTS.quotaFamily;
}
// Effort tier this entry presets (e.g. "high" for gemini-4-hydrogen-high). A tiered
// entry is the same model at a fixed effort, so pickers list the bare id and drive
// effort through reasoning_effort; resolution still finds every tier by id.
// Declared, never derived: "-max"/"-high" suffixes are real model names elsewhere
// (qwen3-max, flux-2-max, grok-4.5-high).
export function modelTier(model) {
  return typeof model?.tier === "string" ? model.tier : null;
}
export function modelStrip(model) {
  return model?.strip || [];
}
export function modelTargetFormat(model) {
  return model?.targetFormat || MODEL_DEFAULTS.targetFormat;
}

// Per-model declared upstream formats (e.g. ["openai", "claude"]). Guards the
// sourceFormat-matched transport for multi-endpoint providers whose models differ
// in endpoint support (opencode-go: kimi/glm only do /chat/completions, minimax/qwen
// also do /messages, deepseek also does /responses).
export function modelSupportedFormats(model) {
  return model?.supportedFormats || null;
}
