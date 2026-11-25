// Resolve valid thinking levels per model — drives UI level picker (suffix "model(level)").
// Reuses capabilities.js (thinkingFormat/canDisable) so this file only maps format→levels (DRY).
import { getCapabilitiesForModel } from "./capabilities.js";
import { matchPattern } from "./pricing.js";
import { resolveKiroEffortPath } from "../config/kiroConstants.js";
import { getModelMeta } from "../config/providerModels.js";
import { modelTier } from "./models/schema.js";

// Shared level sets (deduped) — verified against provider docs + wire in thinkingUnified.applyFormat.
const L = {
  base: ["none", "low", "medium", "high"],                          // qwen, step, hunyuan, gemini-budget
  onOff: ["none", "thinking"],                                      // zai (binary), minimax (adaptive)
  openai: ["none", "minimal", "low", "medium", "high", "xhigh"],    // GPT-5.x / o-series (no "max")
  levelMax: ["none", "low", "medium", "high", "max"],               // kimi
  budgetX: ["none", "low", "medium", "high", "xhigh", "max"],       // claude-budget, claude-adaptive
  gemini: ["minimal", "low", "medium", "high"],                     // gemini-3 thinkingLevel (no disable)
  hiMax: ["none", "high", "max"],                                   // deepseek (low/med→high, xhigh→max)
};

// thinkingFormat → valid selectable levels (source of truth for UI options).
const FORMAT_LEVELS = {
  openai: L.openai,
  "claude-adaptive": L.budgetX,
  "claude-budget": L.budgetX,
  "gemini-level": L.gemini,
  "gemini-budget": L.base,
  zai: L.onOff,
  qwen: L.base,
  kimi: L.levelMax,
  deepseek: L.hiMax,
  commandcode: ["none", "low", "medium", "high", "xhigh", "max"],
  minimax: L.onOff,
  hunyuan: L.base,
  step: L.base,
  nous: L.base,
};

const CODEX_GPT_5_6_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

// Opus/Sonnet 4.6 lack xhigh (Anthropic + Kiro docs) — keep the 4-level+max set.
const CLAUDE_NO_XHIGH = ["none", "low", "medium", "high", "max"];

const AG_CLAUDE_5_5_LEVELS = ["low", "medium", "high", "max"];
// Model-name pattern overrides (glob, first match wins) — more precise than format default.
const PATTERN_THINKING = [
  // Gemini 4 Neon & Hydrogen support xhigh in addition to low/medium/high (no minimal/none).
  { pattern: "*gemini-4-neon*", levels: ["low", "medium", "high", "xhigh"] },
  { pattern: "*gemini-4-hydrogen*", levels: ["low", "medium", "high", "xhigh"] },
  // Gemini 4 (Argon, Carbon) rejects "minimal" with 400 — LOW is the floor; cannot disable thinking.
  { pattern: "*gemini-4*", levels: ["low", "medium", "high"] },
  // Per-model level sets from Google's own table (docs.cloud.google.com Gemini thinking +
  // aistudio thinking guide). The gemini-level format default advertises "minimal", which
  // these models reject with 400 INVALID_ARGUMENT, so each family below pins its real set.
  { pattern: "*gemini-3.8*", levels: ["low", "medium", "high"] },
  { pattern: "*gemini-3.7*", levels: ["low", "medium", "high"] },
  { pattern: "*gemini-3.1-pro*", levels: ["low", "medium", "high"] },
  // 3 Pro predates the medium tier: only low and high, and no minimal.
  { pattern: "*gemini-3-pro*", levels: ["low", "high"] },
  // Antigravity Claude 5.5 supports low, medium, high, max (no xhigh, no none).
  { provider: "antigravity", pattern: "*claude*sonnet-5-5*", levels: AG_CLAUDE_5_5_LEVELS },
  { provider: "antigravity", pattern: "*claude*sonnet-5.5*", levels: AG_CLAUDE_5_5_LEVELS },
  { provider: "antigravity", pattern: "*claude*opus-5-5*", levels: AG_CLAUDE_5_5_LEVELS },
  { provider: "antigravity", pattern: "*claude*opus-5.5*", levels: AG_CLAUDE_5_5_LEVELS },
  { pattern: "*claude*4.6*", levels: CLAUDE_NO_XHIGH },
  { pattern: "*claude*4-6*", levels: CLAUDE_NO_XHIGH },
  { provider: "codex", pattern: "*gpt-6*", levels: CODEX_GPT_5_6_LEVELS },
  { provider: "codex", pattern: "*gpt-5.6-sol*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-terra*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-luna*", levels: CODEX_GPT_5_6_LEVELS },
  { pattern: "*codex*", levels: ["low", "medium", "high", "xhigh"] }, // codex cannot disable thinking
  // OpenCode Free (oc) MiMo rides the same OpenRouter-backed route as the rest of
  // that lane and takes the full OpenAI effort enum verbatim (probed live: all
  // seven values 200, anything else 400 "Invalid option"), so it owns the entry
  // ahead of the unqualified *mimo*v2.6* one below — that one describes Xiaomi's
  // own API, and its [none..xhigh] set would make max unreachable here (the
  // deepseek wire branch clamps max→high when the declared set lacks it).
  { provider: "opencode", pattern: "*mimo*v2.6*", levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
  { pattern: "*mimo*v2.6*", levels: ["none", "low", "medium", "high", "xhigh"] },
  // mimo-v2.5-pro on opencode-go rejects reasoning_effort "max" (probed live); v2.5 accepts it.
  { pattern: "*mimo*v2.5-pro*", levels: ["none", "low", "medium", "high", "xhigh"] },
  // DeepSeek v4.* (Alibaba MaaS, probed live): effort low|medium|high|xhigh|max
  // all 200 via output_config.effort; "none" is a 400 on the anthropic route
  // (disable thinking instead). none kept for the picker = disable.
  // ⚠️ The codebuddy-cn exact ids below MUST stay above this unqualified glob —
  // PATTERN_THINKING is first-match-wins, so a later provider-qualified entry
  // would never fire for dotted ids like deepseek-v4.1-flash.
  { provider: "codebuddy-cn", pattern: "deepseek-v4-pro",     levels: ["low", "high", "xhigh"] },
  { provider: "codebuddy-cn", pattern: "deepseek-v4.1-flash", levels: ["low", "high", "max"] },
  // OpenCode Zen free tier (oc / ocz) — the free id of the same v4.1-flash model
  // publishes low|high|max as well, and unlike DeepSeek's own API the upstream
  // forwards the level verbatim (no low→high collapse). The generic
  // *deepseek-v4.* glob below would advertise medium/xhigh, which the model does
  // not serve, so this entry MUST stay above it.
  // Alibaba Model Studio (docs.qwencloud.com, alibabacloud.com Model Studio): the
  // Qwen 3.8 family serves low|medium|xhigh with xhigh as the DEFAULT — the top tier
  // is not `high`, so the generic qwen set made the model's best level unreachable.
  // qwen4-max is thinking-on-by-default, so `none` stays available as the off switch.
  { provider: "alitp-intl", pattern: "*qwen3.8*", levels: ["none", "low", "medium", "xhigh"] },
  { provider: "alitp-intl", pattern: "*qwen4*", levels: ["none", "low", "medium", "xhigh"] },
  { provider: "qwencloud", pattern: "*qwen3.8*", levels: ["none", "low", "medium", "xhigh"] },
  { provider: "qwencloud", pattern: "*qwen4*", levels: ["none", "low", "medium", "xhigh"] },
  // GLM-5.x: the zai wire maps effort to low|high|max (see applyFormat "zai"). A
  // `thinking`-only advertised set claimed the picker had just on/off while the wire
  // was already sending those three tiers. Only providers without their own entry
  // below need this; codebuddy-cn publishes a narrower per-model set.
  { provider: "glm-cn", pattern: "glm-5.*", levels: ["none", "low", "high", "max"] },
  { provider: "glm", pattern: "glm-5.*", levels: ["none", "low", "high", "max"] },
  { provider: "ocz", pattern: "glm-5.*", levels: ["none", "low", "high", "max"] },
  { provider: "oc", pattern: "glm-5.*", levels: ["none", "low", "high", "max"] },
  { pattern: "*deepseek-v4.1-flash-free*", levels: ["low", "high", "max"] },
  // DeepSeek's own API serves low|high|max (api-docs.deepseek.com Chat Completions:
  // "Possible values: none, low, high, max", medium/xhigh map to high). A provider-
  // scoped entry keeps low reachable there without narrowing the alias globs below,
  // which also describe gateways that forward the level verbatim.
  { provider: "deepseek", pattern: "*deepseek-v4*", levels: ["none", "low", "high", "max"] },
  { pattern: "*deepseek-v4.*", levels: ["none", "low", "medium", "high", "xhigh", "max"] },
  // codebuddy-cn per-model effort sets — the server's product-config payload
  // publishes `reasoning.supportedEfforts` per model. NOTE: the chat endpoint
  // accepts any level you send (probed none/minimal/low/medium/high/xhigh/max
  // → all 200), but values outside a model's supportedEfforts are silently
  // clamped, so the declared set stays authoritative for the picker. Models
  // that publish no supportedEfforts (glm-5.1 / kimi-k3-1 / minimax-m3)
  // fall through to the openai format default.
  { provider: "codebuddy-cn", pattern: "glm-5.3",      levels: ["low", "high", "max"] },
  { provider: "codebuddy-cn", pattern: "glm-5.3-flash", levels: ["low", "high", "max"] },
  { provider: "codebuddy-cn", pattern: "glm-5.2",      levels: ["high", "xhigh"] },
  { provider: "codebuddy-cn", pattern: "kimi-k2.8-preview",  levels: ["low", "medium", "high"] },
  { provider: "codebuddy-cn", pattern: "hy3",          levels: ["low", "high"] },
  { provider: "codebuddy-cn", pattern: "hy4-preview",  levels: ["high"] },
  // codebuddy-intl rides the same gateway catalog, so its deepseek levels match.
  { provider: "codebuddy-intl", pattern: "deepseek-v4*", levels: ["low", "high", "xhigh"] },
  // MiniMax Code (mcode) — adaptive effort via output_config.effort. M3.1
  // always thinks (no none); M3 is switchable with none/high only, per the
  // magpie static catalog. M2.7 pair falls through to the claude-adaptive
  // set minus none (canDisable: false).
  { provider: "minimax-code", pattern: "MiniMax-M3.1*", levels: ["low", "medium", "high", "xhigh", "max"] },
  { provider: "minimax-code", pattern: "MiniMax-M3", levels: ["none", "high"] },
  { provider: "minimax-code-global", pattern: "MiniMax-M3.1*", levels: ["low", "medium", "high", "xhigh", "max"] },
  { provider: "minimax-code-global", pattern: "MiniMax-M3", levels: ["none", "high"] },
];

// OpenAI documents reasoning.effort "max" for GPT-5.6 and GPT-6 (#5186). The codex rows
// above already carry it; an OpenAI Compatible node serving the same ids gets the same
// set, otherwise the "openai" format list (no max) clamps max to xhigh on the wire.
const OPENAI_MAX_EFFORT_MODEL = /(?:^|\/)gpt-(?:5\.6|6)(?:[.-]|$)/i;
const isOpenAICompatibleNode = (provider) => String(provider || "").startsWith("openai-compatible-");

// Returns valid thinking levels for a model, or null when the model has no reasoning.
export function getThinkingLevels(provider, model) {
  const normalizedProvider = provider === "ag" ? "antigravity" : provider;
  if (normalizedProvider === "kiro" && resolveKiroEffortPath(model) === null) return null;
  const caps = getCapabilitiesForModel(normalizedProvider, model);
  if (!caps.reasoning) return null;
  const baseId = String(model || "").replace(/\([^()]+\)\s*$/, "");
  // A tiered entry is one fixed effort ("gemini-4-neon-low"), not the whole family:
  // advertising low..high on it lets a client ask for a level the id cannot honour.
  const pinned = modelTier(getModelMeta(normalizedProvider, baseId));
  if (pinned) return [pinned];
  const modelLevels = getModelMeta(normalizedProvider, baseId)?.thinkingLevels;
  const hit = PATTERN_THINKING.find((entry) =>
    (!entry.provider || entry.provider === normalizedProvider) && matchPattern(entry.pattern, model)
  );
  let levels = modelLevels || hit?.levels
    || (isOpenAICompatibleNode(normalizedProvider) && OPENAI_MAX_EFFORT_MODEL.test(baseId) ? CODEX_GPT_5_6_LEVELS : null)
    || FORMAT_LEVELS[caps.thinkingFormat] || L.base;
  if (caps.thinkingCanDisable === false) levels = levels.filter((l) => l !== "none");
  return levels;
}
