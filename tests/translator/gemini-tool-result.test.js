// Gemini functionResponse tool-result serialization, including `$ref` compatibility.
//
// Upstream v0.5.99 fixed the original Gemini-3 problem centrally: every
// `functionResponse.response` is now run through `sanitizeFunctionResponsePayload`
// (see open-sse/translator/formats/gemini.js), which renames `$ref` keys
// recursively instead of rejecting or stringifying the payload. The fork's older
// `serializeGeminiToolResult` (stringify local-ref payloads) was dropped as
// upstream-equivalent; this test locks the upstream behavior on both translator
// paths (OpenAI → Gemini and Claude → Antigravity).
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// JSON-Schema-bearing tool results: every `$ref` (local `#/...` or absolute)
// must be renamed to `_ref`, recursively, with no rejection.
const SCHEMA_CASES = [
  {
    name: "top-level local ref",
    content: '{"$ref":"#/$defs/command","$defs":{"command":{"type":"object"}}}',
    expectRef: true,
  },
  {
    name: "nested local ref",
    content: '{"result":{"command":{"schema":{"$ref":"#/$defs/command"}}},"$defs":{"command":{"type":"object"}}}',
    expectRef: true,
  },
  {
    name: "array local ref",
    content: '[{"name":"command","schema":{"$ref":"#/$defs/command"}}]',
    expectRef: true,
  },
  {
    name: "external ref",
    content: '{"$ref":"https://example.com/schema.json#/command","result":"ok"}',
    expectRef: true,
  },
];

const STRUCTURED_CASES = [
  {
    name: "plain JSON",
    content: '{"ok":true,"value":42}',
    expected: { ok: true, value: 42 },
  },
  {
    name: "$defs without a ref",
    content: '{"$defs":{"command":{"type":"object"}},"result":"ok"}',
    expected: { $defs: { command: { type: "object" } }, result: "ok" },
  },
];

// Deepest `result` value, tolerating the per-path wrapping depth.
const payloadAt = (value) => {
  let cur = value;
  while (cur && typeof cur === "object" && "result" in cur) cur = cur.result;
  return cur;
};

const getFunctionResponse = (translated) => {
  const request = translated.request || translated;
  return request.contents
    .flatMap((content) => content.parts)
    .find((part) => part.functionResponse)
    .functionResponse.response;
};

const openAIRequest = (content) => translateRequest(
  FORMATS.OPENAI,
  FORMATS.GEMINI,
  "gemini-3.7-flash",
  {
    messages: [
      { role: "user", content: "Run the command." },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "command", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call_1", content },
    ],
  },
  true,
  null,
  "gemini",
);

const claudeRequest = (content) => translateRequest(
  FORMATS.CLAUDE,
  FORMATS.ANTIGRAVITY,
  "claude-opus-4-6",
  {
    messages: [
      { role: "user", content: "Run the command." },
      { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "command", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content }] },
    ],
  },
  true,
  { projectId: "project-1", connectionId: "connection-1" },
  "antigravity",
);

const collectRefValues = (value, acc = []) => {
  if (Array.isArray(value)) { value.forEach((v) => collectRefValues(v, acc)); return acc; }
  if (!value || typeof value !== "object") return acc;
  for (const [k, v] of Object.entries(value)) {
    if (k === "$ref") acc.push(v);
    collectRefValues(v, acc);
  }
  return acc;
};

describe.each([
  ["OpenAI → Gemini", "openai", openAIRequest],
  ["Claude → Antigravity", "claude", claudeRequest],
])("%s tool results", (_path, responsePath, translate) => {
  // Both paths shape the tool result identically: { result: <payload> }.
  const unwrap = (response) => response.result;

  it.each(SCHEMA_CASES)("renames schema `ref` keys in $name (no rejection, stays structured)", ({ content }) => {
    const response = getFunctionResponse(translate(content));
    const serialized = JSON.stringify(response);
    const payload = unwrap(response);

    // The whole point: no `$ref` survives anywhere in the emitted payload...
    expect(serialized).not.toContain('"$ref"');
    // ...and the payload is NOT stringified, it stays structured JSON.
    expect(typeof payload).toBe("object");
    // Renamed to `_ref`, recursively, preserving each pointer value verbatim.
    expect(serialized).toContain('"_ref"');
    for (const ref of collectRefValues(JSON.parse(content))) {
      expect(serialized).toContain(ref);
    }
  });

  it.each(STRUCTURED_CASES)("keeps $name structured", ({ content, expected }) => {
    const response = getFunctionResponse(translate(content));

    expect(response.result).toEqual(expected);
    expect(typeof response.result).toBe("object");
  });

  it("keeps invalid JSON and plain text as text (not mis-parsed)", () => {
    const content = "plain tool output {not valid JSON}";
    const response = getFunctionResponse(translate(content));

    // Unparseable tool output must stay a string; it must not be coerced to an
    // object or dropped. (Wrapping depth differs per path, so assert on the text.)
    expect(JSON.stringify(response)).toContain(content);
    expect(typeof payloadAt(response)).toBe("string");
  });
});
