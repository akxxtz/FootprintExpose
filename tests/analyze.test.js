import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRequest, MAX_IMAGES, buildGeminiBody } from "../api/analyze.js";

test("validateRequest rejects missing mode", () => {
  const r = validateRequest({});
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("validateRequest rejects unknown mode", () => {
  const r = validateRequest({ mode: "video" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("validateRequest rejects text mode without profile", () => {
  const r = validateRequest({ mode: "text" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("validateRequest accepts text mode with profile", () => {
  const r = validateRequest({ mode: "text", profile: { username: "x" } });
  assert.equal(r.ok, true);
});

test("validateRequest rejects photo mode with no images", () => {
  const r = validateRequest({ mode: "photo", images: [] });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("validateRequest rejects too many images", () => {
  const images = Array(MAX_IMAGES + 1).fill("AAAA");
  const r = validateRequest({ mode: "photo", images });
  assert.equal(r.ok, false);
  assert.equal(r.status, 413);
});

test("validateRequest accepts photo mode with images", () => {
  const r = validateRequest({ mode: "photo", images: ["AAAA"] });
  assert.equal(r.ok, true);
});

test("validateRequest rejects null / non-object body", () => {
  assert.equal(validateRequest(null).status, 400);
  assert.equal(validateRequest("text").status, 400);
  assert.equal(validateRequest(42).status, 400);
});

test("validateRequest rejects array profile in text mode", () => {
  const r = validateRequest({ mode: "text", profile: [] });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("validateRequest rejects non-string image entries", () => {
  const r = validateRequest({ mode: "photo", images: ["AAAA", 123, null] });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("validateRequest rejects images over the total size cap", () => {
  // MAX_TOTAL_B64 is 4_000_000; one oversized string exceeds it.
  const big = "A".repeat(4_000_001);
  const r = validateRequest({ mode: "photo", images: [big] });
  assert.equal(r.ok, false);
  assert.equal(r.status, 413);
});

test("buildGeminiBody (text) puts profile JSON in a text part", () => {
  const body = buildGeminiBody({ mode: "text", profile: { username: "alex" } });
  const parts = body.contents[0].parts;
  assert.ok(parts.some(p => typeof p.text === "string" && p.text.includes("alex")));
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.ok(body.generationConfig.responseSchema);
});

test("buildGeminiBody (photo) adds one inlineData part per image", () => {
  const body = buildGeminiBody({ mode: "photo", images: ["AAAA", "BBBB"] });
  const parts = body.contents[0].parts;
  const inline = parts.filter(p => p.inlineData);
  assert.equal(inline.length, 2);
  assert.equal(inline[0].inlineData.mimeType, "image/jpeg");
  assert.equal(inline[0].inlineData.data, "AAAA");
});

test("buildGeminiBody (photo) schema includes an extracted field", () => {
  const body = buildGeminiBody({ mode: "photo", images: ["AAAA"] });
  assert.ok(body.generationConfig.responseSchema.properties.extracted);
});

test("buildGeminiBody (photo) tolerates missing images array", () => {
  const body = buildGeminiBody({ mode: "photo" });
  const inline = body.contents[0].parts.filter(p => p.inlineData);
  assert.equal(inline.length, 0); // no images, but no throw
  assert.ok(body.contents[0].parts.some(p => typeof p.text === "string"));
});

test("INFERENCE_ITEM severity is bounded 1-25 in the schema", () => {
  const body = buildGeminiBody({ mode: "text", profile: { username: "x" } });
  const sev = body.generationConfig.responseSchema.properties.inferences.items.properties.severity;
  assert.equal(sev.minimum, 1);
  assert.equal(sev.maximum, 25);
});

import { normalizeResult } from "../api/analyze.js";

function fakeGeminiResponse(obj) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] };
}

test("normalizeResult clamps severity, sorts desc, caps at 8", () => {
  const inferences = Array.from({ length: 10 }, (_, i) => ({
    id: "i" + i, severity: i + 50, category: "general",
    title: "t" + i, summary: "s", explain: "e", chain: ["a", "→ b"]
  }));
  const out = normalizeResult(fakeGeminiResponse({ inferences }));
  assert.equal(out.inferences.length, 8);
  assert.equal(out.inferences[0].severity, 25); // clamped to max
  assert.ok(out.inferences[0].severity >= out.inferences[1].severity); // sorted
});

test("normalizeResult drops malformed inferences", () => {
  const out = normalizeResult(fakeGeminiResponse({
    inferences: [
      { id: "ok", severity: 5, category: "general", title: "t", summary: "s", explain: "e", chain: ["x"] },
      { id: "bad", severity: 5 } // missing title/explain/chain
    ]
  }));
  assert.equal(out.inferences.length, 1);
  assert.equal(out.inferences[0].id, "ok");
});

test("normalizeResult passes through extracted[] for photo", () => {
  const out = normalizeResult(fakeGeminiResponse({
    extracted: [{ label: "School crest", value: "SMK Damansara" }],
    inferences: [{ id: "a", severity: 9, category: "location", title: "t", summary: "s", explain: "e", chain: ["x"] }]
  }));
  assert.equal(out.extracted[0].value, "SMK Damansara");
});

test("normalizeResult throws on empty candidates", () => {
  assert.throws(() => normalizeResult({ candidates: [] }));
});

test("normalizeResult throws a clean error on non-JSON text", () => {
  const bad = { candidates: [{ content: { parts: [{ text: "not json <html>" }] } }] };
  assert.throws(() => normalizeResult(bad), /non-JSON/);
});

test("normalizeResult returns empty arrays when inferences key is absent", () => {
  const out = normalizeResult({ candidates: [{ content: { parts: [{ text: JSON.stringify({}) }] } }] });
  assert.deepEqual(out.inferences, []);
  assert.deepEqual(out.extracted, []);
});

import { runAnalysis } from "../api/analyze.js";

test("runAnalysis throws a 500-style error when apiKey missing", async () => {
  await assert.rejects(
    () => runAnalysis({ mode: "text", profile: { username: "x" } }, { apiKey: "" }),
    /key/i
  );
});

test("runAnalysis sends the key via header, not the URL, and returns normalized result", async () => {
  let sentKey = "", calledUrl = "";
  const fetchImpl = async (url, opts) => {
    calledUrl = url;
    sentKey = opts.headers["x-goog-api-key"];
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        inferences: [{ id: "a", severity: 9, category: "general", title: "t", summary: "s", explain: "e", chain: ["x"] }]
      }) }] } }] })
    };
  };
  const out = await runAnalysis({ mode: "text", profile: { username: "x" } }, { apiKey: "SECRET", fetchImpl });
  assert.equal(sentKey, "SECRET");
  assert.ok(!calledUrl.includes("SECRET")); // key must NOT be in the URL
  assert.equal(out.inferences.length, 1);
});

test("runAnalysis throws when Gemini returns non-OK", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "boom" });
  await assert.rejects(
    () => runAnalysis({ mode: "text", profile: { username: "x" } }, { apiKey: "K", fetchImpl })
  );
});

import handler from "../api/analyze.js";

function mockRes() {
  return {
    statusCode: 0, body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; }
  };
}

test("handler rejects non-POST with 405", async () => {
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 405);
});

test("handler returns 400 on invalid body", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: { mode: "nope" } }, res);
  assert.equal(res.statusCode, 400);
});

test("handler returns a generic 500 without leaking the env var name when key missing", async () => {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const res = mockRes();
    await handler({ method: "POST", body: { mode: "text", profile: { username: "x" } } }, res);
    assert.equal(res.statusCode, 500);
    assert.ok(!/GEMINI_API_KEY/.test(res.body.error)); // no leak
  } finally {
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  }
});

import { normalizeCaption } from "../api/analyze.js";

test("validateRequest rejects caption mode without caption", () => {
  assert.equal(validateRequest({ mode: "caption" }).status, 400);
  assert.equal(validateRequest({ mode: "caption", caption: "   " }).status, 400);
});

test("validateRequest accepts caption mode with a caption", () => {
  assert.equal(validateRequest({ mode: "caption", caption: "walking home" }).ok, true);
});

test("buildGeminiBody (caption) includes the caption and a caption schema", () => {
  const body = buildGeminiBody({ mode: "caption", caption: "walking home from practice" });
  const parts = body.contents[0].parts;
  assert.ok(parts.some(p => typeof p.text === "string" && p.text.includes("walking home from practice")));
  const props = body.generationConfig.responseSchema.properties;
  assert.ok(props.attackerView && props.safeAlternative && props.explanation);
});

test("normalizeCaption returns the three caption fields", () => {
  const gj = { candidates: [{ content: { parts: [{ text: JSON.stringify({
    attackerView: "reveals route", safeAlternative: "safe text", explanation: "why"
  }) }] } }] };
  const out = normalizeCaption(gj);
  assert.equal(out.attackerView, "reveals route");
  assert.equal(out.safeAlternative, "safe text");
  assert.equal(out.explanation, "why");
});

test("normalizeCaption throws on empty candidates", () => {
  assert.throws(() => normalizeCaption({ candidates: [] }));
});

test("runAnalysis (caption) returns caption fields via injected fetch", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      attackerView: "a", safeAlternative: "b", explanation: "c"
    }) }] } }] })
  });
  const out = await runAnalysis({ mode: "caption", caption: "x" }, { apiKey: "K", fetchImpl });
  assert.equal(out.safeAlternative, "b");
});
