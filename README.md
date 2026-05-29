# Footprint Expose

A cybersecurity-awareness web app that shows — viscerally — how much a predator can infer from seemingly harmless public profile details. The user enters a fictional teen profile, and the app animates a "predator's inference web" piecing together a likely real name, a narrowed location, a daily schedule, and contact opportunities.

The goal is **emotional impact, not technical accuracy**. Every inference is plausible, scripted, and entirely synthetic — there are no real OSINT lookups, no API calls, and no real people involved.

> Built as a group project for **WIC2007 Cyber Security** (Year 2, Semester 2).

---

## What it does

1. **Landing screen** — dark, unsettling hero with a single CTA: *Build a profile*.
2. **Profile form** — social-media-styled inputs: username, age, school, sports team / club, neighbourhood mentions, recent post snippets, and optional pet / sibling / hangout fields.
3. **Analysing transition** — a 3–5 second terminal-style scan log that builds dread.
4. **Inference web** — a force-directed graph appears node-by-node. Click any node to see *how* the inference was made (e.g. *"School + sports team + 'walking home from practice' → predator can be waiting at the school gate Tue/Thu 5pm"*).
5. **Severity meter** — a 0–100 exposure score that climbs as nodes appear.
6. **Reveal screen** — plain-language summary of what the attacker could do, plus a *safer alternative* for each input field.
7. **Reset** — start over with a different profile.

---

## How to run it

This is a **single-file** React app with no build step. Everything (React, Babel, Tailwind) is pulled from CDNs and the inference rules are inlined, so it runs straight from disk.

### Option 1 — open directly
Double-click `app/index.html`, or drag it into a browser. Works from `file://`.

### Option 2 — serve locally (recommended)
Some browsers restrict `file://` scripts. From the project root in PowerShell:

```powershell
cd app
python -m http.server 8000
```

Then visit <http://localhost:8000/>.

No `npm install`, no Node, no backend.

---

## Project structure

```
FootprintExpose/
├── app/
│   ├── index.html            # The entire app — React + Tailwind + Babel via CDN
│   └── inferenceRules.json   # Editable rule pack (mirrored inline in index.html)
├── docs/
│   └── superpowers/specs/
│       └── 2026-05-22-footprint-expose-design.md   # Design doc / spec
├── .agents/                  # Project-local agent skills
├── .claude/                  # Claude Code settings
└── README.md
```

> `inferenceRules.json` and the inline rules block at the top of `index.html` should stay in sync. The inline copy is the source of truth for the single-file build; the JSON file exists so non-developers can review and propose new rules.

---

## How the inference engine works

The engine is a **rule-based scripted system**, not real OSINT. Each rule has the shape:

> **IF** input contains *X* (and optionally *Y*) **THEN** emit inference node *Z* with explanation *E* and severity *S*.

Example rules:

| Trigger | Inference |
|---|---|
| `school + sports team` | Predictable weekly location at practice times. |
| Username contains a birth year | Age confirmed — grooming approach can be tailored. |
| `"walking home"` in a post | Walks alone — vulnerability window identified. |
| Pet name + sibling name | Likely password-recovery answers. |
| Too few inputs (fallback) | "Even this much is enough to start a conversation that feels personal." |

Rules are evaluated in order, deduplicated, and scored. The top ~8 surface as graph nodes; their severities feed the 0–100 meter.

---

## Architecture

- **Single-page, fully client-side.** No backend, no telemetry, no storage. The privacy story *is* part of the lesson: *"We didn't send your inputs anywhere — a real attacker would."*
- **Framework:** React 18 (UMD build) + Babel Standalone, loaded from CDN.
- **Styling:** Tailwind CSS via CDN, with custom fonts (Instrument Serif, Space Grotesk, JetBrains Mono).
- **State:** Local React state only. Nothing persists between sessions.
- **No build step.** One HTML file is the deliverable.

### Screens / components (inside `index.html`)

| Component | Responsibility |
|---|---|
| `App` | Routes between landing → form → analysing → web → reveal |
| `LandingScreen` | Hook + CTA + content warning |
| `ProfileForm` | Collects fake profile inputs |
| `AnalysingScreen` | Animated terminal log, paced reveal |
| `InferenceEngine` | Pure function: `(profile) ⇒ inference[]` |
| `InferenceGraph` | Force-directed visualisation; click a node for the explanation card |
| `SeverityMeter` | Animated 0–100 score bar |
| `RevealScreen` | Plain-language summary + per-field "safer alternative" |

---

## Safety & ethical guardrails

- **No real profile lookups.** Inputs never leave the browser.
- **Prefilled sample profiles** (clearly fictional, e.g. `alex_runs_2010`) so users aren't tempted to enter their own real info. A banner reminds them.
- **No grooming scripts shown.** Inferences stop at *what an attacker could know*, never *what they would say*.
- **Teacher mode** lets a facilitator pre-load the demo, skip the analysing delay, and pace the reveals manually.
- **Content warning** on the landing screen.

---

## Out of scope

To keep the project shippable in a semester, the following are intentionally excluded:

- Accounts, logins, or saved profiles
- Real social-media scraping or any API calls
- Multiplayer / classroom dashboard features
- Localisation beyond English
- Any backend service

---

## Success criteria

- A teen who completes one run can, unprompted, name **three specific things they post that they shouldn't**.
- A teacher can run the demo for a class in **under 10 minutes**.
- The app works **offline** after first load (static site, CDN-cached).
- Lighthouse accessibility score **≥ 90**.

---

## Contributing / editing rules

The most valuable contribution is **better inference rules**. To add one:

1. Edit `app/inferenceRules.json` with the proposed rule (trigger, inference text, explanation, severity).
2. Mirror the change into the inline rules block near the top of `app/index.html` (this is what actually runs).
3. Re-open the page to test — no build needed.

Please keep rules plausible and educational. Anything resembling an actual grooming script will be rejected.

---

## Credits

Group project for **WIC2007 Cyber Security**. Design spec authored 2026-05-22; see `docs/superpowers/specs/2026-05-22-footprint-expose-design.md` for the full design rationale.
