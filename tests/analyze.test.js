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

test("runAnalysis calls fetch with the key and returns normalized result", async () => {
  let calledUrl = "";
  const fetchImpl = async (url) => {
    calledUrl = url;
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        inferences: [{ id: "a", severity: 9, category: "general", title: "t", summary: "s", explain: "e", chain: ["x"] }]
      }) }] } }] })
    };
  };
  const out = await runAnalysis({ mode: "text", profile: { username: "x" } }, { apiKey: "SECRET", fetchImpl });
  assert.ok(calledUrl.includes("SECRET"));
  assert.equal(out.inferences.length, 1);
});

test("runAnalysis throws when Gemini returns non-OK", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "boom" });
  await assert.rejects(
    () => runAnalysis({ mode: "text", profile: { username: "x" } }, { apiKey: "K", fetchImpl })
  );
});
