# Footprint Expose v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-file static app into a unified Footprint Expose that keeps the text-profile flow, adds real multi-photo AI analysis, hides the Gemini key behind a Vercel serverless proxy, and deploys to Vercel.

**Architecture:** Static CDN-React frontend (`app/index.html`, no build step) calls one Vercel serverless function (`api/analyze.js`) that holds `GEMINI_API_KEY` in env and proxies to Gemini 2.5 Flash for both text and vision. The function returns the existing inference schema so the current Analysing → Web → Reveal screens render unchanged. `analyzer.html` is retired.

**Tech Stack:** HTML + React 18 (UMD via CDN) + Babel Standalone + Tailwind CDN (frontend, unchanged toolchain); Node 18+ ESM serverless function on Vercel; Gemini 2.5 Flash REST API; `node:test` for backend unit tests (zero deps).

**Testing note:** The frontend is intentionally a no-build, Babel-in-browser single file (locked decision), so it has no JS unit harness — frontend tasks use manual verification via `vercel dev` and browser DevTools. The backend's real logic lives in pure exported helpers and **is** unit-tested with `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-04-footprint-expose-v2-design.md`

---

## File Structure

- Create: `api/analyze.js` — serverless function + exported pure helpers (request build, response normalize, validation).
- Create: `tests/analyze.test.js` — `node:test` unit tests for the helpers. (In `tests/`, NOT `api/`, so Vercel does not deploy it as a route.)
- Create: `package.json` — `type: module`, Node 18+, `test`/`dev` scripts.
- Create: `vercel.json` — serve `app/` as static output; `/api/*` are functions.
- Create: `.env.example` — documents `GEMINI_API_KEY`.
- Modify: `.gitignore` — add `.env` and `.env*.local`.
- Modify: `app/index.html` — remove key UI + direct Gemini calls; add `callAnalyze()` + `compressImage()` helpers; add photo mode (mode selector, multi-upload, compression); add "what the AI saw" panel; reframe privacy copy.
- Delete: `app/analyzer.html`, `app/image_4ec0c2.jpg`, `app/image_4ecba1.jpg`.
- Modify: `README.md` — v2 deploy steps + privacy reframe.

---

## Task 1: Scaffold Vercel project files

**Files:**
- Create: `package.json`
- Create: `vercel.json`
- Create: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "footprint-expose",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "dev": "vercel dev",
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `vercel.json`**

`outputDirectory: "app"` serves the static frontend from `app/`; functions in the root `api/` directory are auto-detected by Vercel regardless of `outputDirectory`.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "outputDirectory": "app",
  "cleanUrls": true
}
```

- [ ] **Step 3: Create `.env.example`**

```bash
# Server-side Gemini key. NEVER commit a real key.
# Local dev: copy to .env.local and fill in. Production: set in Vercel dashboard.
GEMINI_API_KEY=your-gemini-api-key-here
```

- [ ] **Step 4: Append env ignores to `.gitignore`**

Add these lines to the end of the existing `.gitignore`:

```gitignore

# Secrets
.env
.env*.local

# Vercel
.vercel
node_modules
```

- [ ] **Step 5: Commit**

```bash
git add package.json vercel.json .env.example .gitignore
git commit -m "chore: scaffold Vercel project (config, env example, gitignore)"
```

---

## Task 2: Backend pure helpers — validation (TDD)

**Files:**
- Create: `api/analyze.js`
- Test: `tests/analyze.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/analyze.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/analyze.test.js`
Expected: FAIL — cannot import `validateRequest` / module not found.

- [ ] **Step 3: Create `api/analyze.js` with the validator**

```js
// Footprint Expose — Gemini proxy (text + vision). Key stays server-side.

export const MAX_IMAGES = 5;
const MAX_TOTAL_B64 = 4_000_000; // ~4MB encoded, under Vercel's ~4.5MB body cap

export function validateRequest(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, error: "Missing request body." };
  }
  const { mode } = body;
  if (mode !== "text" && mode !== "photo") {
    return { ok: false, status: 400, error: "mode must be 'text' or 'photo'." };
  }
  if (mode === "text") {
    if (!body.profile || typeof body.profile !== "object") {
      return { ok: false, status: 400, error: "text mode requires a profile object." };
    }
    return { ok: true };
  }
  // photo
  const images = body.images;
  if (!Array.isArray(images) || images.length === 0) {
    return { ok: false, status: 400, error: "photo mode requires at least one image." };
  }
  if (images.length > MAX_IMAGES) {
    return { ok: false, status: 413, error: `Too many images (max ${MAX_IMAGES}).` };
  }
  const total = images.reduce((n, s) => n + (typeof s === "string" ? s.length : 0), 0);
  if (total > MAX_TOTAL_B64) {
    return { ok: false, status: 413, error: "Images too large — remove one and try again." };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/analyze.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add api/analyze.js tests/analyze.test.js
git commit -m "feat(api): request validation for analyze endpoint"
```

---

## Task 3: Backend pure helpers — Gemini request body (TDD)

**Files:**
- Modify: `api/analyze.js`
- Test: `tests/analyze.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/analyze.test.js`:

```js
import { buildGeminiBody } from "../api/analyze.js";

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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/analyze.test.js`
Expected: FAIL — `buildGeminiBody` not exported.

- [ ] **Step 3: Implement schemas, prompts, and `buildGeminiBody`**

Add to `api/analyze.js`:

```js
const INFERENCE_ITEM = {
  type: "OBJECT",
  properties: {
    id: { type: "STRING" },
    severity: { type: "INTEGER" },
    category: { type: "STRING", enum: ["schedule","identity","physical","location","account","emotional","general"] },
    title: { type: "STRING" },
    summary: { type: "STRING" },
    explain: { type: "STRING" },
    chain: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["id","severity","category","title","summary","explain","chain"]
};

const TEXT_SCHEMA = {
  type: "OBJECT",
  properties: { inferences: { type: "ARRAY", items: INFERENCE_ITEM } },
  required: ["inferences"]
};

const PHOTO_SCHEMA = {
  type: "OBJECT",
  properties: {
    extracted: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { label: { type: "STRING" }, value: { type: "STRING" } },
        required: ["label", "value"]
      }
    },
    inferences: { type: "ARRAY", items: INFERENCE_ITEM }
  },
  required: ["extracted", "inferences"]
};

const TEXT_SYSTEM = `You are a child-safety analyst running an educational simulator. The user submitted a deliberately fake teen social profile. Enumerate the specific inferences a predator could draw, grounded ONLY in the fields provided. Never invent facts. Output 4-8 distinct inferences ranked by severity (1-25). Each inference's chain must cite the exact field values used. Each chain's final step must start with "→" and state the predator's conclusion.`;

const PHOTO_SYSTEM = `You are a child-safety analyst running an educational simulator. The user uploaded one or more (fictional/sample) images a teen might post publicly. These may be plain photos OR screenshots of social posts (e.g. Instagram) where on-screen text is visible. First, in "extracted", list every concrete detail visible across ALL images as {label, value} pairs — combine clues across images. Read and include BOTH: (a) any on-screen UI text — username/handle, display name, caption, hashtags, location tag, timestamp, commenter usernames, comment text; and (b) physical scene details — school crest, street sign, sports kit, house number, reflections, time-of-day, recognisable landmarks. Then in "inferences", enumerate 4-8 specific things a predator could conclude, ranked by severity (1-25), each chain citing which visible detail(s) it used and ending with a "→" conclusion. Ground everything ONLY in what is actually visible/legible. Never invent.`;

export function buildGeminiBody({ mode, profile, images }) {
  if (mode === "text") {
    return {
      systemInstruction: { parts: [{ text: TEXT_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text:
`Analyse this profile. chain[] must list 2-4 evidence steps; the final step starts with "→". summary is one sentence <=140 chars. explain is 2-4 sentences, second person.

PROFILE:
${JSON.stringify(profile, null, 2)}` }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: TEXT_SCHEMA, temperature: 0.6 }
    };
  }
  // photo
  const parts = [{ text: "Analyse these images together. Fill extracted[] with observable details, then inferences[] as instructed." }];
  for (const data of images) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
  return {
    systemInstruction: { parts: [{ text: PHOTO_SYSTEM }] },
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: PHOTO_SCHEMA, temperature: 0.6 }
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/analyze.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add api/analyze.js tests/analyze.test.js
git commit -m "feat(api): build Gemini request body for text and photo modes"
```

---

## Task 4: Backend pure helpers — normalize Gemini response (TDD)

**Files:**
- Modify: `api/analyze.js`
- Test: `tests/analyze.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/analyze.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/analyze.test.js`
Expected: FAIL — `normalizeResult` not exported.

- [ ] **Step 3: Implement `normalizeResult`**

Add to `api/analyze.js`:

```js
export function normalizeResult(geminiJson) {
  const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini.");
  const parsed = JSON.parse(text);
  const inferences = (Array.isArray(parsed.inferences) ? parsed.inferences : [])
    .filter(i => i && i.title && i.explain && Array.isArray(i.chain))
    .map(i => ({ ...i, severity: Math.max(1, Math.min(25, parseInt(i.severity, 10) || 5)) }))
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 8);
  const extracted = Array.isArray(parsed.extracted) ? parsed.extracted : [];
  return { inferences, extracted };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/analyze.test.js`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add api/analyze.js tests/analyze.test.js
git commit -m "feat(api): normalize Gemini response into inference schema"
```

---

## Task 5: Backend handler — wire env key, fetch Gemini, error paths

**Files:**
- Modify: `api/analyze.js`
- Test: `tests/analyze.test.js`

- [ ] **Step 1: Add a failing test for the callable core**

The handler itself needs `req`/`res`; to keep it unit-testable, extract the network step into `runAnalysis({ mode, profile, images }, { apiKey, fetchImpl })`. Append to `tests/analyze.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/analyze.test.js`
Expected: FAIL — `runAnalysis` not exported.

- [ ] **Step 3: Implement `runAnalysis` and the default handler**

Add to `api/analyze.js`:

```js
const GEMINI_MODEL = "gemini-2.5-flash";

export async function runAnalysis(input, { apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) {
    const err = new Error("Server is missing GEMINI_API_KEY.");
    err.status = 500;
    throw err;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildGeminiBody(input))
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const err = new Error(`Gemini ${res.status}: ${txt.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }
  return normalizeResult(await res.json());
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }
  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  const check = validateRequest(body);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  try {
    const out = await runAnalysis(body, { apiKey: process.env.GEMINI_API_KEY });
    return res.status(200).json({ source: "gemini", ...out });
  } catch (e) {
    const status = e.status || 502;
    return res.status(status).json({ error: e.message || "Analysis failed." });
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/analyze.test.js`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add api/analyze.js tests/analyze.test.js
git commit -m "feat(api): analyze handler with env key, Gemini fetch, error paths"
```

---

## Task 6: Frontend — route text mode through the backend, remove key UI

**Files:**
- Modify: `app/index.html`

This task changes text mode to call `/api/analyze` and **deletes** all client-side key handling. The scripted `runInference` stays as an offline fallback.

- [ ] **Step 1: Add the `callAnalyze` helper**

In `app/index.html`, right after the `GEMINI_SCHEMA` block (≈ line 271), add:

```js
async function callAnalyze(payload) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data; // { source, inferences, extracted }
}
```

- [ ] **Step 2: Delete client-side key code**

Remove these from `app/index.html`:
- The `getApiKey` and `setApiKey` functions (≈ lines 236-246).
- `runInferenceGemini` (≈ lines 273-310) — replaced by `callAnalyze`.
- The `GEMINI_KEY_STORAGE` const (≈ line 234).
- In `ProfileForm`: the `apiKey`/`showKey` state (≈ lines 482-483), `saveKey` (≈ line 488), and the entire "Gemini API key (optional)" UI block (≈ lines 525-560).
- In `TopBar`: the `client-side only · key stored locally` line (≈ lines 430-432).

- [ ] **Step 3: Rewrite `startFromProfile` to use the backend**

Replace the body of `startFromProfile` (≈ lines 379-399) with:

```js
async function startFromProfile(prof) {
  const scripted = runInference(prof);
  setProfile(prof);
  setInferences(scripted);
  setAiError(null);
  setExtracted([]);
  setScreen("analysing");
  setSource("loading");
  try {
    const data = await callAnalyze({ mode: "text", profile: prof });
    if (data.inferences?.length) { setInferences(data.inferences); setSource("ai"); }
    else { setSource("scripted"); setAiError("AI returned no inferences — using scripted fallback."); }
  } catch (e) {
    console.error(e);
    setSource("scripted");
    setAiError((e.message || "AI call failed") + " — using scripted fallback.");
  }
}
```

- [ ] **Step 4: Add `extracted` state to `App`**

In `App`, add alongside the other `useState` calls (≈ line 377):

```js
const [extracted, setExtracted] = useState([]);
```

And pass it to `Reveal` (≈ line 408):

```jsx
{screen === "reveal" && <Reveal profile={profile} inferences={inferences} source={source} extracted={extracted} onRestart={() => setScreen("landing")} />}
```

- [ ] **Step 5: Verify manually**

Run: `npx vercel dev` (first run links the project — accept defaults; set `GEMINI_API_KEY` in `.env.local` first, see Task 10 Step 1).
Open the printed localhost URL, fill a sample profile, submit.
Expected: Analysing → inference web renders; Network tab shows a `POST /api/analyze` (200) and **no** Google API call from the browser. Stop with the key removed from `.env.local` and resubmit → still works via scripted fallback with the error badge.

- [ ] **Step 6: Commit**

```bash
git add app/index.html
git commit -m "feat(web): route text mode through serverless proxy, remove client key UI"
```

---

## Task 7: Frontend — image compression helper + photo upload UI

**Files:**
- Modify: `app/index.html`

- [ ] **Step 1: Add `compressImage` helper**

After `callAnalyze` in `app/index.html`, add:

```js
// Downscale to <=1536px longest edge, JPEG q0.85, return raw base64 (no data: prefix).
// 1536/0.85 keeps screenshot text (handles, captions, comments) legible for the AI's
// OCR while staying well under Vercel's ~4.5MB body cap for up to 5 images.
const MAX_IMAGES = 5;
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1536 / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve(dataUrl.split(",")[1]); // strip "data:image/jpeg;base64,"
    };
    img.onerror = () => reject(new Error("Could not read image."));
    img.src = URL.createObjectURL(file);
  });
}
```

- [ ] **Step 2: Add the `PhotoForm` component**

Add a new component near `ProfileForm` in `app/index.html`:

```jsx
function PhotoForm({ onSubmit }) {
  const [items, setItems] = useState([]); // { id, preview, b64 }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function addFiles(fileList) {
    setErr(null);
    const files = Array.from(fileList).filter(f => f.type.startsWith("image/"));
    if (items.length + files.length > MAX_IMAGES) {
      setErr(`Max ${MAX_IMAGES} images.`);
      return;
    }
    setBusy(true);
    try {
      const added = [];
      for (const f of files) {
        const b64 = await compressImage(f);
        added.push({ id: Math.random().toString(36).slice(2), preview: `data:image/jpeg;base64,${b64}`, b64 });
      }
      setItems(prev => [...prev, ...added]);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  function remove(id) { setItems(prev => prev.filter(x => x.id !== id)); }

  return (
    <section className="max-w-3xl mx-auto px-6 py-12">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-3xl"><span className="font-medium">Upload</span> <span className="display text-red-300">photos</span></h2>
        <span className="eyebrow text-[10px] text-zinc-500">step 1 / 3</span>
      </div>
      <p className="text-zinc-400 text-sm mb-6">
        Plain photos or screenshots of posts (handle, caption, comments) both work — the AI reads the text and the image itself, no typing needed.
        <span className="text-red-400"> Use your own test post or a mock-up, not a stranger's real post.</span>
      </p>

      <label className="block border border-dashed border-white/15 rounded-lg p-8 text-center cursor-pointer hover:border-red-400/50 transition">
        <input type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <span className="mono text-xs text-zinc-400">{busy ? "Processing…" : `Click to add images (max ${MAX_IMAGES})`}</span>
      </label>

      {err && <p className="text-red-400 text-xs mt-3">{err}</p>}

      {items.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mt-5">
          {items.map(it => (
            <div key={it.id} className="relative group">
              <img src={it.preview} className="w-full h-24 object-cover rounded border border-white/10" alt="upload" />
              <button onClick={() => remove(it.id)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white text-xs leading-none">×</button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 flex justify-end">
        <button disabled={items.length === 0 || busy}
          onClick={() => onSubmit(items.map(x => x.b64))}
          className={`px-6 py-2.5 rounded-md font-semibold transition ${items.length && !busy ? "bg-red-500 hover:bg-red-400 text-black glow-red" : "bg-zinc-800 text-zinc-500 cursor-not-allowed"}`}>
          Analyse photos →
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Verify it renders (temporary route)**

Temporarily change `App`'s landing CTA target or add `{screen === "photo" && <PhotoForm onSubmit={(imgs) => console.log(imgs.length)} />}` and a button to reach it. Run `npx vercel dev`, add 1-2 images, confirm thumbnails + remove work and console logs the count. Revert the temporary wiring after confirming (Task 8 wires it properly).

- [ ] **Step 4: Commit**

```bash
git add app/index.html
git commit -m "feat(web): add image compression helper and PhotoForm upload UI"
```

---

## Task 8: Frontend — mode selector + photo analysis flow

**Files:**
- Modify: `app/index.html`

- [ ] **Step 1: Add `startFromPhotos` to `App`**

Add this function inside `App` (next to `startFromProfile`):

```js
async function startFromPhotos(images) {
  setProfile({ __photo: true, count: images.length });
  setInferences([]);
  setExtracted([]);
  setAiError(null);
  setScreen("analysing");
  setSource("loading");
  try {
    const data = await callAnalyze({ mode: "photo", images });
    setInferences(data.inferences || []);
    setExtracted(data.extracted || []);
    setSource(data.inferences?.length ? "ai" : "scripted");
    if (!data.inferences?.length) setAiError("The AI couldn't read enough from these images.");
  } catch (e) {
    console.error(e);
    setSource("scripted");
    setAiError(e.message || "Photo analysis failed.");
  }
}
```

- [ ] **Step 2: Add a `mode` to landing and route to the right form**

Update `App`'s screen state to support a `photoForm` screen and add a `mode` choice on landing. Change the `Landing` CTA area to offer both, and update the router (≈ lines 404-408):

```jsx
{screen === "landing"   && <Landing onText={() => setScreen("form")} onPhoto={() => setScreen("photoForm")} />}
{screen === "form"      && <ProfileForm onSubmit={startFromProfile} />}
{screen === "photoForm" && <PhotoForm onSubmit={startFromPhotos} />}
```

- [ ] **Step 3: Update `Landing` to show two CTAs**

Replace the single-button block in `Landing` (≈ lines 461-466) and update its props (≈ line 447 `function Landing({ onStart })` → `function Landing({ onText, onPhoto })`):

```jsx
<div className="mt-10 flex flex-wrap justify-center gap-3">
  <button onClick={onText}
    className="px-6 py-3 rounded-md bg-red-500 hover:bg-red-400 text-black font-semibold transition glow-red">
    Build a profile →
  </button>
  <button onClick={onPhoto}
    className="px-6 py-3 rounded-md border border-red-400/40 text-red-200 hover:bg-red-500/10 font-semibold transition">
    Analyse photos →
  </button>
</div>
```

- [ ] **Step 4: Verify the full photo path**

Run `npx vercel dev` (with a real `GEMINI_API_KEY` in `.env.local`). From landing, click "Analyse photos", add 1 then up to 5 sample images, click Analyse.
Expected: Analysing → inference web renders from the images; Network shows `POST /api/analyze` with `mode:"photo"` returning 200; DevTools shows no Google key anywhere. Also confirm text mode still works from "Build a profile".
Include at least one **screenshot of a mock social post** (visible handle, caption, a comment): confirm the result's `extracted`/inferences reference the on-screen handle/caption/comment text, proving OCR works at the 1536px/0.85 compression setting.

- [ ] **Step 5: Commit**

```bash
git add app/index.html
git commit -m "feat(web): mode selector and end-to-end photo analysis flow"
```

---

## Task 9: Frontend — "What the AI saw" panel + privacy reframe

**Files:**
- Modify: `app/index.html`

- [ ] **Step 1: Render `extracted` in `Reveal`**

In the `Reveal` component, add (near the top of its returned content, before the per-field/inference sections) a panel shown only when `extracted` has entries:

```jsx
{extracted && extracted.length > 0 && (
  <div className="rounded-lg border border-amber-400/30 bg-amber-500/[0.05] p-5 mb-6">
    <div className="eyebrow text-[10px] text-amber-300 mb-3">What the AI read off your photos</div>
    <div className="grid sm:grid-cols-2 gap-2">
      {extracted.map((e, i) => (
        <div key={i} className="text-sm">
          <span className="text-zinc-400">{e.label}: </span>
          <span className="text-zinc-100">{e.value}</span>
        </div>
      ))}
    </div>
  </div>
)}
```

Ensure `Reveal`'s signature accepts `extracted` (it was passed in Task 6 Step 4): `function Reveal({ profile, inferences, source, extracted, onRestart })`.

- [ ] **Step 2: Reframe the privacy copy**

- In `Landing`, replace the "This simulator never sends your input anywhere…" block (≈ lines 467-470) with:

```jsx
<div className="mt-12 mono text-[11px] text-zinc-500 max-w-md mx-auto leading-relaxed">
  What you enter here is sent to a server and on to a third-party AI — just like the
  apps you use every day. That's the point: you'd never see it happen.
</div>
```

- In `Footer`, replace the text (≈ line 441) with:

```jsx
Educational demo. Inputs are sent to an AI for analysis. Use only fictional data.
```

- [ ] **Step 3: Verify manually**

Run `npx vercel dev`. Run a photo analysis → the amber "What the AI read off your photos" panel appears on the reveal with label/value pairs. Run a text analysis → panel is absent (no `extracted`). Landing + footer show the new copy.

- [ ] **Step 4: Commit**

```bash
git add app/index.html
git commit -m "feat(web): extracted-details panel and updated privacy framing"
```

---

## Task 10: Retire analyzer.html, update README, deploy to Vercel

**Files:**
- Delete: `app/analyzer.html`, `app/image_4ec0c2.jpg`, `app/image_4ecba1.jpg`
- Modify: `README.md`

- [ ] **Step 1: Create `.env.local` for local dev (not committed)**

```bash
# In repo root; .env.local is gitignored (Task 1)
echo "GEMINI_API_KEY=YOUR_REAL_KEY" > .env.local
```

Verify it is ignored: `git status` must NOT list `.env.local`.

- [ ] **Step 2: Delete the retired files**

```bash
git rm "app/analyzer.html" "app/image_4ec0c2.jpg" "app/image_4ecba1.jpg"
```

- [ ] **Step 3: Update `README.md`**

Replace the "How to run it" and "Architecture" sections to reflect v2:
- Run locally with `npx vercel dev` (needs `.env.local` with `GEMINI_API_KEY`).
- Two modes: text profile and multi-photo upload.
- Key is server-side in a Vercel env var; the browser never holds it.
- Privacy reframe: data is sent to a serverless function → Gemini.
- Remove references to `analyzer.html`, the preset images, and "open index.html from disk / works from file://".
- Note the inference rules still live in `app/inferenceRules.json` mirrored into `index.html`'s scripted fallback.

- [ ] **Step 4: Commit the cleanup + docs**

```bash
git add -A
git commit -m "docs: v2 README; retire analyzer.html and preset images"
```

- [ ] **Step 5: Deploy to Vercel**

```bash
npx vercel link        # link/create the project (accept defaults)
npx vercel env add GEMINI_API_KEY production   # paste the real key when prompted
npx vercel env add GEMINI_API_KEY preview      # paste the real key when prompted
npx vercel --prod      # deploy
```

- [ ] **Step 6: Final verification on the deployed URL**

On the production URL:
- Text mode: build a sample profile → inference web + reveal render.
- Photo mode: upload 1 and 5 sample images → extracted panel + inferences render.
- DevTools Network: only `POST /api/analyze` is called; the Gemini key appears nowhere in client requests or source.
- Oversized/too-many images and a deliberately wrong key both surface a friendly error, not a blank screen.

- [ ] **Step 7: Commit any final tweaks**

```bash
git add -A
git commit -m "chore: v2 deploy verification fixes" --allow-empty
```

---

## Self-Review (completed during planning)

- **Spec coverage:** unified app (Tasks 6-9), photo mode + multi-image (Tasks 7-8), Gemini-for-everything proxy (Tasks 2-5), env secret + no client key (Tasks 1, 5, 6), Vercel deploy (Tasks 1, 10), client-side compression for the ~4.5MB body cap (Tasks 2, 7), "what the AI saw" panel (Task 9), privacy reframe (Task 9), retire analyzer.html + jpgs (Task 10), inference schema parity (Tasks 3-4 mirror the existing `title/explain/chain/severity` shape and top-8 post-processing). All spec sections map to a task.
- **Placeholder scan:** no TBD/TODO; every code step shows real code; every run step shows the command and expected outcome.
- **Type consistency:** helper names are stable across tasks — `validateRequest`, `buildGeminiBody`, `normalizeResult`, `runAnalysis`, `callAnalyze`, `compressImage`, `startFromProfile`, `startFromPhotos`, `extracted` state and `Reveal` prop. The response shape `{ source, inferences, extracted }` is produced by the handler (Task 5) and consumed identically by the frontend (Tasks 6, 8, 9).
```
