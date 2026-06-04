import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRequest, MAX_IMAGES } from "../api/analyze.js";

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
