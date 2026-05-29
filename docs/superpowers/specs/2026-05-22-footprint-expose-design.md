# Digital Footprint Exposure Simulator — Design

## Purpose

A web app that raises cybersecurity awareness in teens by showing — viscerally — how much a predator can infer from seemingly harmless public profile details. The user enters a fake teen profile (username, school, sports team, neighbourhood hints from posts), and the app animates a "predator's inference web" piecing together real name, narrowed location, daily schedule, and contact opportunities.

The goal is emotional impact, not technical accuracy. The inferences are plausible, scripted, and entirely synthetic — no real OSINT lookups, no real people.

## Audience & Use Context

- **Primary users:** Teens (13–17) in a classroom or workshop setting.
- **Secondary users:** Teachers, parents, and awareness facilitators who run the demo.
- **Session length:** 3–5 minutes from input to final reveal.
- **Device:** Desktop/laptop browser first; mobile responsive secondary.

## Core Experience (User Journey)

1. **Landing screen.** A dark, slightly unsettling hero with a tagline ("They only need a few clues."). Single CTA: *Build a profile*.
2. **Profile input form.** A friendly, social-media-styled form. Fields:
   - Username / handle
   - Age
   - School name
   - Sports team / club
   - Neighbourhood or area mentions
   - Recent post snippets (free text, up to 3)
   - Optional: pet name, sibling name, favourite hangout
3. **"Analysing…" transition.** A 3–5 second animated scan with a terminal-style log streaming inferences. Builds dread.
4. **The inference web.** A force-directed graph appears node-by-node:
   - Center node: the fake profile.
   - Branching outward: *Likely real name*, *Location narrowed to ~X km*, *Daily schedule*, *When alone*, *Likely contact channels*, *Emotional hooks*.
   - Each node, on click, expands a card explaining **how** the inference was made ("School + sports team + 'walking home from practice' → predator can be waiting at the school gate Tue/Thu 5pm").
5. **Severity meter.** A 0–100 "exposure score" climbs as nodes appear.
6. **Reveal screen.** Plain-language summary: *Here's what they could do with this. Here's what would have stopped it.* Each input field gets a "safer alternative" suggestion.
7. **Share / reset.** Option to download a printable summary or restart with a different profile.

## Inference Engine (The Heart)

This is **not** real OSINT. It's a rule-based scripted engine that produces alarming but plausible inferences from input keywords.

- **Rule format:** `IF input contains X (and Y) THEN emit inference node Z with explanation E and severity S`.
- **Rule packs** live in a JSON file (`src/data/inferenceRules.json`) so non-developers can review and expand them.
- **Example rules:**
  - `school + sports team` → "Predictable weekly location at practice times."
  - `username contains birth year` → "Age confirmed; grooming approach can be tailored."
  - `'walking home' in post` → "Walks alone — vulnerability window identified."
  - `pet name + sibling name` → "Likely password recovery answers."
- **Fallback:** If too few inputs, emit generic-but-still-uncomfortable inferences ("Even this much is enough to start a conversation that feels personal.").

Rules are evaluated in order, deduplicated, and scored. Top ~8 are rendered as graph nodes.

## Architecture

Single-page web app, fully client-side. No backend, no data collection — this is itself a privacy talking point ("We didn't send your inputs anywhere. A real attacker would.").

- **Framework:** React + Vite (fast, simple, well-known).
- **Styling:** Tailwind CSS for speed; dark, slightly menacing palette.
- **Graph rendering:** `react-flow` or `vis-network` for the inference web (force-directed, animated node arrivals).
- **Animations:** Framer Motion for transitions and the analysing screen.
- **State:** Local React state only. No persistence between sessions.

## Component Breakdown

| Component | Responsibility |
|---|---|
| `App` | Routing between screens (landing → form → analysing → web → reveal) |
| `LandingScreen` | Hook + CTA |
| `ProfileForm` | Collects fake profile inputs; validates non-empty |
| `AnalysingScreen` | Animated terminal log, 3–5s timer |
| `InferenceEngine` | Pure function: `(profile) => inference[]` |
| `InferenceGraph` | Force-directed visualisation; node click → detail card |
| `SeverityMeter` | Animated 0–100 score bar |
| `RevealScreen` | Plain-language summary + "safer alternatives" per field |
| `inferenceRules.json` | Editable rule pack |

## Data Flow

```
ProfileForm → profile object → InferenceEngine(rules, profile)
            → inferences[] → AnalysingScreen (paced reveal)
            → InferenceGraph (nodes appear over time)
            → SeverityMeter (accumulates)
            → RevealScreen (full summary + remediation)
```

## Safety & Ethical Guardrails

- **No real profile lookups.** Inputs never leave the browser.
- **Prefilled sample profiles** (clearly fictional names like "alex_runs_2010") so users don't enter their own real info. A banner reminds them.
- **No grooming scripts shown.** Inferences stop at "what they could know," not "what they would say."
- **Teacher mode toggle:** Lets a facilitator pre-load the demo, skip the analysing wait, and pace reveals manually.
- **Content warning** on landing screen.

## Out of Scope (YAGNI)

- Accounts, user logins, saving profiles.
- Real social media scraping or API calls.
- Multiplayer / classroom dashboard.
- Localisation beyond English (v1).
- A backend of any kind.

## Success Criteria

- A teen who completes one run can, unprompted, name 3 specific things they post that they shouldn't.
- A teacher can run the demo for a class in under 10 minutes.
- The app works offline after first load (static site).
- Lighthouse accessibility score ≥ 90.

## Open Questions (resolve during implementation)

- Exact rule pack contents — needs sign-off from a teacher/counsellor before publishing.
- Severity-score weighting formula — start with simple sum, tune from playtesting.
