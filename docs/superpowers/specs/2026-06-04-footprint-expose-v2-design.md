# Footprint Expose v2 — Unified App with AI Photo Analysis + Vercel Deploy

> Supersedes the v1 design (`2026-05-22-footprint-expose-design.md`) where they conflict.
> v1 was a single static HTML file with a client-side Gemini key and a separate
> `analyzer.html` clone. v2 unifies everything into one frontend backed by a
> serverless proxy, adds real AI photo analysis, and is actually deployed.

## Purpose

Keep the educational goal of v1 — show teens, viscerally, how much an attacker can
infer from harmless-looking public details — while adding a **photo analysis** mode
and moving to a **deployable, key-safe architecture**. The user can either type a
fictional profile or upload one or more photos; an AI extracts the inferable details
and animates the same "predator's inference web", severity meter, and reveal.

## Decisions (locked during brainstorming, 2026-06-04)

- **Merge** the two HTML files into one unified app (retire `analyzer.html`).
- **Real AI photo analysis** — the AI extracts details from the image(s); no manual
  form for the photo path.
- **Gemini for everything** — Gemini 2.5 Flash (natively multimodal) handles both
  text and vision. DeepSeek V4 Flash was considered but is text-only as of June 2026
  and cannot accept images, so it is **dropped** from the project.
- **Serverless proxy + env secret** — the Gemini key lives in a Vercel env var, never
  in the browser. The client-side API-key screen is removed.
- **Deploy on Vercel.**
- **Keep the no-build CDN React frontend** — minimal rewrite of working code; add one
  serverless function. No Vite migration.
- **Keep both input modes** (text profile *and* photo); photo mode accepts **multiple**
  images.

## Architecture

```
Browser (static frontend, app/index.html, CDN React — no build)
   │  POST /api/analyze  { mode, profile | images[] }
   ▼
Vercel serverless function (api/analyze.js, Node 18+)
   │  reads GEMINI_API_KEY from env
   ▼
Gemini 2.5 Flash (generativelanguage.googleapis.com)
   │  returns structured JSON (existing inference schema)
   ▼
Function → Browser → Analysing → Inference Web → Severity → Reveal
```

- **Fully client-side rendering, server-side secret.** The browser never holds the
  Gemini key. The only new server code is one function that proxies to Gemini.
- **No persistence.** Uploaded images are processed in memory and never stored.

## Input modes

Both modes converge on the **existing** screen flow:
`Analysing → InferenceGraph → SeverityMeter → RevealScreen`.

### Text mode (existing, lightly changed)
- The current profile form is unchanged in fields and validation.
- On submit, instead of calling Gemini directly from the browser, it calls
  `POST /api/analyze` with `{ mode: "text", profile }`.
- The scripted `runInference` engine is retained as an **offline fallback** if the
  backend call fails (preserves the v1 "works without a key" resilience for text).

### Photo mode (new)
- Entry point: a mode selector on the landing/form screen — "Type a profile" vs
  "Upload photos".
- A multi-file image picker (`accept="image/*" multiple`) with thumbnail previews and
  per-image remove buttons. **Max 5 images.**
- **No manual fields.** Gemini Vision reads the image(s) *together* and extracts the
  inferable details itself. Analysing several "harmless" photos at once — and showing
  how they combine — is an intended teaching beat.
- **Screenshots of posts are first-class input.** Images may be plain photos *or*
  screenshots of social posts (e.g. Instagram) where on-screen text is visible. Gemini
  reads text in images natively (OCR), so the username/handle, caption, hashtags,
  location tag, timestamp, and commenter usernames/comments are all extracted with no
  extra plumbing. The vision prompt explicitly directs the model to read both the
  on-screen UI text and the physical scene.
- On analyse, the (compressed) images are sent as `{ mode: "photo", images: [base64...] }`.
- The reveal additionally shows an **"What the AI saw in your photos"** panel
  (the `extracted` block) before the inference web, so the user sees the raw read
  before the conclusions.

## Backend: `POST /api/analyze`

- **Runtime:** Node 18+ (global `fetch`, no external deps required). A minimal
  `package.json` declares the function.
- **Request body (JSON):**
  - Text: `{ "mode": "text", "profile": { ...existing profile fields... } }`
  - Photo: `{ "mode": "photo", "images": ["<base64 jpeg>", ...] }`
- **Behaviour:**
  - Reads `process.env.GEMINI_API_KEY`.
  - **Text:** reuses the existing `GEMINI_SYSTEM` instruction and the text prompt
    (the `chain[]` / `summary` / `explain` format), with `responseSchema = GEMINI_SCHEMA`.
  - **Photo:** sends a vision prompt plus each image as a Gemini `inlineData` part
    (`{ inlineData: { mimeType, data } }`). The prompt instructs Gemini to (a) extract
    what is visible/inferable across all images, and (b) emit inferences in the **same
    schema** as text mode.
  - Calls `gemini-2.5-flash:generateContent` with `responseMimeType: "application/json"`
    and the shared `responseSchema`.
- **Response shape (matches the existing frontend renderer):**
  ```json
  {
    "source": "gemini",
    "inferences": [
      { "title": "...", "explain": "...", "chain": ["...", "→ ..."], "severity": 17, "category": "..." }
    ],
    "extracted": { "...": "..." }   // photo mode only — what the AI read off the images
  }
  ```
  - `inferences`: filtered to entries with `title`, `explain`, and an array `chain`;
    `severity` clamped to 1–25; sorted descending; **top 8** — identical post-processing
    to the existing `runInferenceGemini`.
- **Errors (friendly JSON messages):**
  - Missing `GEMINI_API_KEY` → `500`.
  - Gemini call fails / non-OK → `502`.
  - Payload too large → `413`.
  - Bad/empty body → `400`.

## Key constraint: Vercel body limit → client-side image compression

Vercel serverless functions cap the request body at **~4.5 MB**. Multiple raw
base64 photos exceed this easily, so the **frontend compresses each image before
upload**:

- Draw each selected image onto a `<canvas>`, downscaled so the longest edge is
  **≤ ~1536 px**, and export as **JPEG at ~0.85 quality**. These values are chosen so
  that **text in post screenshots (handles, captions, comments) stays legible for the
  model's OCR** — 1024 px / 0.8 smears small comment text on tall screenshots. Five
  1536 px JPEGs at 0.85 land around ~1–2 MB total, comfortably under the body cap.
- Cap the number of images at **5**.
- If the combined encoded payload still looks too large, warn the user and ask them to
  remove an image rather than failing opaquely.

This keeps requests small and fast and avoids `413`s in normal use.

## Repo / deployment layout

```
api/
  analyze.js          # Vercel serverless function (Gemini proxy)
app/
  index.html          # unified frontend: key UI removed, photo mode added
vercel.json           # serve app/ as static site, expose /api as functions
package.json          # minimal; Node 18+ engine
.env.example          # documents GEMINI_API_KEY (no real value)
.gitignore            # adds .env and .env*.local
docs/superpowers/specs/...
README.md             # updated for v2 (deploy steps, privacy reframe)
```

- **Static serving:** `vercel.json` routes `/` to `app/index.html` and serves the
  `app/` assets statically while keeping `/api/*` as serverless functions.
- **Secrets:** the real key is set in the **Vercel dashboard** env vars
  (Production + Preview). `.env.local` (gitignored) holds the key for local
  `vercel dev`. `.env.example` documents the variable name only.

## Files removed

- `app/analyzer.html` — its preset-screenshot approach is fully replaced by real upload.
- `app/image_4ec0c2.jpg`, `app/image_4ecba1.jpg` — the preset images it referenced.

## Copy / privacy reframe

v1's selling point was "we never send your inputs anywhere." v2 **does** send data to
a serverless function and on to a third-party AI, so that claim is removed and the
lesson is reframed:

> *"Your photos just went to a server you don't control — and on to a third-party AI.
> That's exactly how easily it happens. You trusted this demo; a real app you'd trust
> the same way."*

Update: landing content warning, reveal-screen copy, README, and this design's framing.

## Safety & ethical guardrails (carried over + updated)

- **Fictional inputs encouraged.** Sample text profiles remain clearly fictional; for
  photo mode, a banner reminds users to upload **non-personal / stock / consented**
  images, not real photos of real minors. Because **post screenshots** capture other
  people's handles, faces, and comments, the banner explicitly tells users to use their
  own test post or a mock-up — **not a stranger's real post**.
- **No grooming scripts.** Inferences stop at *what an attacker could know*, never
  *what they would say*.
- **No storage.** Images are processed in memory and never persisted or logged.
- **Content warning** remains on the landing screen.

## Out of scope (YAGNI)

- Accounts, logins, saved sessions.
- Storing or persisting uploaded images; any database.
- DeepSeek (text-only; cannot do the vision step).
- Vite / build-step migration.
- Multiplayer / classroom dashboard.
- Localisation beyond English.

## Success criteria

- A user can upload one or more photos and, with **no manual data entry**, see an
  AI-extracted "what the photos reveal" panel plus the inference web and reveal.
- Text mode still works end-to-end through the backend, with the scripted engine as an
  offline fallback.
- The Gemini key is **never present in client code or network requests from the
  browser** — only the call to `/api/analyze` is visible.
- The app is deployed on Vercel and reachable at a public URL with the key in env vars.
- Oversized uploads and a missing key both fail with clear, friendly messages.

## Testing (light, manual — group-project scope)

Run locally with `vercel dev`, then on a Vercel preview deploy:

1. Text mode produces an inference web and reveal (backend path).
2. Text mode with the backend forced to fail falls back to the scripted engine.
3. Photo mode with **1** image: extracted panel + inferences render.
4. Photo mode with **5** images: combined inferences render; request stays under the
   body limit (verify compression).
5. Oversize / too-many images: graceful `413`/warning, not a crash.
6. Missing `GEMINI_API_KEY`: friendly `500` message, no white screen.
7. Browser DevTools confirms the Gemini key never appears in any request.

## Open questions (resolve during implementation)

- Exact vision prompt wording for the `extracted` block vs the inference list — tune
  from a few real test images.
- Whether to show per-image attribution in the inference chains ("from photo 2: …") or
  keep inferences image-agnostic. Default: image-agnostic unless it reads better.
