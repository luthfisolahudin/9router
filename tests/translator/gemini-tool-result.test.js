// Gemini functionResponse tool-result serialization, including Gemini 3 local-$ref compatibility.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const LOCAL_REF_CASES = [
  {
    name: "top-level local ref",
    content: '{"$ref":"#/$defs/command","$defs":{"command":{"type":"object"}}}',
  },
  {
    name: "nested local ref",
    content: '{"result":{"command":{"schema":{"$ref":"#/$defs/command"}}},"$defs":{"command":{"type":"object"}}}',
  },
  {
    name: "array local ref",
    content: '[{"name":"command","schema":{"$ref":"#/$defs/command"}}]',
  },
];

const STRUCTURED_CASES = [
  {
    name: "plain JSON",
    content: '{"ok":true,"value":42}',
    expected: { ok: true, value: 42 },
  },
  {
    name: "$defs without a local ref",
    content: '{"$defs":{"command":{"type":"object"}},"result":"ok"}',
    expected: { $defs: { command: { type: "object" } }, result: "ok" },
  },
  {
    name: "external ref",
    content: '{"$ref":"https://example.com/schema.json#/command","result":"ok"}',
    expected: { $ref: "https://example.com/schema.json#/command", result: "ok" },
  },
];

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

describe.each([
  ["OpenAI → Gemini", "openai", openAIRequest],
  ["Claude → Antigravity", "claude", claudeRequest],
])("%s tool results", (_path, responsePath, translate) => {
  it.each(LOCAL_REF_CASES)("preserves $name verbatim as text", ({ content }) => {
    const response = getFunctionResponse(translate(content));

    const value = responsePath === "openai" ? response.result.result : response.result;
    expect(value).toBe(content);
    expect(typeof value).toBe("string");
  });

  it.each(STRUCTURED_CASES)("keeps $name structured", ({ content, expected }) => {
    const response = getFunctionResponse(translate(content));

    expect(response.result).toEqual(expected);
    expect(typeof response.result).toBe("object");
  });

  it("keeps invalid JSON and plain text as text", () => {
    const content = "plain tool output {not valid JSON}";
    const response = getFunctionResponse(translate(content));

    const value = responsePath === "openai" ? response.result.result : response.result;
    expect(value).toBe(content);
  });
});
