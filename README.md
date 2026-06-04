# Footprint Expose

A cybersecurity-awareness web app that shows — viscerally — how much a predator can infer from seemingly harmless public profile details. Users can either build a fictional text profile **or upload screenshots of social posts**, and the app produces an animated "predator's inference web" that reveals what an attacker could piece together.

The goal is **emotional impact, not technical accuracy**. Every inference is plausible and grounded in the inputs provided — there are no real OSINT lookups and no real people involved.

> Built as a group project for **WIC2007 Cyber Security** (Year 2, Semester 2).

---

## What it does

1. **Landing screen** — dark, unsettling hero with two CTAs: *Build a text profile* or *Upload photos / post screenshots*.
2. **Text mode** — social-media-styled inputs: username, age, school, sports team / club, neighbourhood mentions, recent post snippets, and optional pet / sibling / hangout fields.
3. **Photo mode** — upload one or more photos or **screenshots of posts** (e.g. Instagram). No typing required. The AI reads on-screen text — handles, captions, hashtags, comments, location tags, timestamps — and physical scene details such as school crests, street signs, and sports kits.
4. **Analysing transition** — a terminal-style scan log that builds dread while the serverless function calls Gemini.
5. **Inference web** — a force-directed graph appears node-by-node. Click any node to see *how* the inference was made (e.g. *"School name in bio + practice-day hashtag → predator can be waiting at the school gate Tue/Thu 5pm"*).
6. **Severity meter** — a 0–100 exposure score that climbs as nodes appear.
7. **Reveal screen** — plain-language summary of what an attacker could do, plus a *safer alternative* for each identified detail.
8. **Caption Rewriter** — on the reveal screen, paste any social-media caption and receive: what a predator infers from it, a predator-safe rewrite in the same teen voice, and an explanation of why the original was risky.
9. **Reset** — start over with a different profile or new photos.

---

## Architecture

### Overview

```
Browser (app/index.html)
        │  POST /api/analyze  (JSON or base64 images)
        ▼
Vercel Serverless Function (api/analyze.js)
        │  Gemini API key — stays server-side, never sent to the browser
        ▼
Google Gemini 2.5 Flash
```

- **Frontend:** React 18 (UMD build) + Babel Standalone + Tailwind CSS, all loaded from CDN. No build step. The entire UI is `app/index.html`.
- **Backend:** A single Vercel serverless function at `api/analyze.js` acts as a proxy. It validates the request, attaches the Gemini key from the environment, calls the Gemini API, and normalises the response. The browser never holds the API key.
- **Three request modes** handled by the same endpoint:
  - `"text"` — profile object → structured inferences
  - `"photo"` — base64 image array → extracted details + inferences
  - `"caption"` — caption string → attacker view, safe alternative, explanation
- **Offline text fallback:** `app/index.html` also contains an inline `runInference` function that applies the scripted rule pack when the network call fails or is unavailable. `inferenceRules.json` mirrors those rules so non-developers can review and propose changes.

### Project structure

```
FootprintExpose/
├── app/
│   ├── index.html            # Entire frontend — React + Tailwind + Babel via CDN
│   └── inferenceRules.json   # Editable rule pack (mirrored inline in index.html)
├── api/
│   └── analyze.js            # Vercel serverless function — Gemini proxy
├── tests/
│   └── analyze.test.js       # Backend unit tests (node:test, no deps)
├── docs/
│   └── superpowers/
│       ├── specs/2026-06-04-footprint-expose-v2-design.md   # current (v2) design
│       └── plans/2026-06-04-footprint-expose-v2.md          # v2 implementation plan
├── .env.example              # Template — copy to .env.local for local dev
├── vercel.json               # Serves app/ as static output; api/ as functions
├── package.json              # npm scripts only; no runtime dependencies
└── README.md
```

> `inferenceRules.json` and the inline rules block in `index.html` should stay in sync. The inline copy is what actually runs; the JSON exists so non-developers can review and propose new rules without reading JavaScript.

### Screens / components (inside `index.html`)

| Component | Responsibility |
|---|---|
| `App` | Routes between landing → form / photoForm → analysing → web → reveal |
| `Landing` | Hook + dual CTA (text / photo) + content warning |
| `ProfileForm` | Collects fictional text-mode inputs |
| `PhotoForm` | File picker; client-side downscale/compress to base64 (≤1536px, JPEG 0.85) |
| `Analysing` | Animated terminal log during the API call |
| `runInference` | Pure function `(profile) ⇒ inference[]` — offline scripted fallback for text mode |
| `InferenceWeb` / `DetailCard` | Force-directed graph; click a node for the explanation card |
| `SeverityMeter` | Animated 0–100 score bar |
| `Reveal` | Summary, per-field "safer alternatives", the extracted-from-photos panel, and the Caption Rewriter |
| `CaptionAnalyzer` | Caption Rewriter tool (predator-safe rewrite via the proxy) |

---

## How the inference engine works

Gemini is the primary engine in v2. The app sends the profile or images to `api/analyze.js` and receives structured JSON inference objects, each with:

- **title / summary** — what the attacker concludes
- **explain** — why this matters (2–4 sentences, second person)
- **chain** — 2–4 evidence steps culminating in a "→" conclusion
- **severity** — 1–25; feeds the 0–100 exposure meter
- **category** — `schedule | identity | physical | location | account | emotional | general`

For text mode, the offline scripted fallback (`runInference`) uses the same rule pack as `inferenceRules.json`:

| Trigger | Inference |
|---|---|
| `school + sports team` | Predictable weekly location at practice times. |
| Username contains a birth year | Age confirmed — grooming approach can be tailored. |
| `"walking home"` in a post | Walks alone — vulnerability window identified. |
| Pet name + sibling name | Likely password-recovery answers. |
| Too few inputs (fallback) | "Even this much is enough to start a conversation that feels personal." |

For **photo mode**, Gemini additionally reads on-screen text in screenshots: usernames, captions, hashtags, location tags, comment text, and timestamps — no typing required.

---

## Running locally

Prerequisites: **Node 18+** and the **Vercel CLI** (`npm i -g vercel`).

1. **Clone the repo** (if you haven't already).
2. **Copy the env template:**
   ```powershell
   copy .env.example .env.local
   ```
   Then open `.env.local` and set:
   ```
   GEMINI_API_KEY=your-gemini-api-key-here
   ```
   Get a free key at <https://aistudio.google.com/app/apikey>.
3. **Start the dev server** (serves `app/` as static files and `api/` as local functions):
   ```powershell
   npx vercel dev
   ```
   Visit the localhost URL printed in the terminal.
4. **Run backend unit tests:**
   ```powershell
   npm test
   ```
   Tests use Node's built-in `node:test` runner — no extra packages needed.

> There are no runtime npm dependencies. `npm install` is not required unless you add dev tooling.

---

## Deploying to Vercel

> **Note:** The human deployer handles this step. It is documented here for completeness.

1. **Set the environment variable** in the Vercel project dashboard under *Settings → Environment Variables* (enable for Production and Preview):
   ```
   GEMINI_API_KEY=<your-key>
   ```
2. **Deploy:**
   ```powershell
   vercel --prod
   ```
   `vercel.json` sets `outputDirectory` to `app/` (served as static files) and automatically registers `api/*.js` as serverless functions.

---

## Privacy & ethics

**Inputs are sent to a third-party AI.** When you submit a profile or photos, the data is sent to our serverless function and forwarded to Google Gemini for analysis. This is intentional — and part of the lesson. For the demo, use only:

- Fictional profiles (the app ships with sample profiles such as `alex_runs_2010`).
- Your own test post or a purpose-made mock-up for photo mode.
- **Never upload a real stranger's post or a real child's photo.**

The old single-file version carried the privacy claim *"we never send your data anywhere."* That claim is gone in v2. The honest lesson is: the moment you hand data to an app — including this one — it may travel further than you expect.

---

## Safety & ethical guardrails

- **No real profile lookups.** The app performs no actual OSINT scraping.
- **Prefilled sample profiles** (clearly fictional) so users are not tempted to enter real personal data. A banner reminds them.
- **No grooming scripts shown.** Inferences stop at *what an attacker could know*, never *what they would say*.
- **Server-side key.** The Gemini key lives only in the serverless function's environment; it is never sent to or exposed in the browser.
- **Content warning** on the landing screen.

---

## Out of scope

To keep the project shippable in a semester, the following are intentionally excluded:

- Accounts, logins, or saved profiles
- Real social-media scraping
- Multiplayer / classroom dashboard features
- Localisation beyond English

---

## Success criteria

- A teen who completes one run can, unprompted, name **three specific things they post that they shouldn't**.
- A teacher can run the demo for a class in **under 10 minutes**.
- Lighthouse accessibility score **≥ 90**.

---

## Contributing / editing rules

The most valuable contribution is **better inference rules** for text mode. To add one:

1. Edit `app/inferenceRules.json` with the proposed rule (trigger, inference text, explanation, severity).
2. Mirror the change into the inline rules block near the top of `app/index.html`.
3. Run `npx vercel dev` and test — no build step needed.

Please keep rules plausible and educational. Anything resembling an actual grooming script will be rejected.

---

## Credits

Group project for **WIC2007 Cyber Security**. The current (v2) design and rationale live in `docs/superpowers/specs/2026-06-04-footprint-expose-v2-design.md`, with the step-by-step build in `docs/superpowers/plans/2026-06-04-footprint-expose-v2.md`. The original single-file design is preserved at `docs/superpowers/specs/2026-05-22-footprint-expose-design.md`.
