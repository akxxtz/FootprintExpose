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
