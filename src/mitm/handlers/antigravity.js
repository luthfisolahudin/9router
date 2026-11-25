const { err, createResponseDumper } = require("../logger");
const { IS_DEV, tierBaseId } = require("../config");
const { getMitmAlias } = require("../dbReader");
const { fetchRouter, pipeSSE } = require("./base");

/**
 * Intercept Antigravity request — forward Gemini body as-is to /v1/chat/completions.
 * Router auto-detects format via body.userAgent==="antigravity" + body.request.contents,
 * runs antigravity→openai→provider→openai→antigravity translators internally.
 */
async function intercept(req, res, bodyBuffer, mappedModel) {
  const dumper = IS_DEV ? createResponseDumper(req, "intercept-antigravity") : null;
  const isStream = req.url.includes(":streamGenerateContent");
  try {
    const body = JSON.parse(bodyBuffer.toString());
    if (body.model) body.model = mappedModel;
    // The IDE states its own effort in generationConfig.thinkingConfig. A mapping
    // that points at a tier preset would otherwise win over it, so drop the preset
    // and let the level decide which tier the router resolves.
    const declaredLevel = body.request?.generationConfig?.thinkingConfig?.thinkingLevel;
    if (typeof declaredLevel === "string" && declaredLevel.trim()) {
      body.model = tierBaseId("antigravity", mappedModel, getMitmAlias("antigravity")) || mappedModel;
    }

    const routerRes = await fetchRouter(body, "/v1/chat/completions", req.headers);
    await pipeSSE(routerRes, res, dumper);
  } catch (error) {
    err(`[antigravity] ${error.message}`);
    if (dumper) { dumper.writeChunk(`\n[ERROR] ${error.message}\n`); dumper.end(); }
    // For stream endpoint, send SSE error chunk so SDK doesn't hang waiting
    if (isStream) {
      if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ error: { message: error.message } })}\r\n\r\n`);
    } else {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.message, type: "mitm_error" } }));
    }
  }
}

module.exports = { intercept };
