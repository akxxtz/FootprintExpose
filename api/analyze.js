// Footprint Expose — Gemini proxy (text + vision). Key stays server-side.

export const MAX_IMAGES = 5;
const MAX_TOTAL_B64 = 4_000_000; // ~4MB encoded, under Vercel's ~4.5MB body cap

export function validateRequest(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, error: "Missing request body." };
  }
  const { mode } = body;
  if (mode !== "text" && mode !== "photo" && mode !== "caption") {
    return { ok: false, status: 400, error: "mode must be 'text', 'photo', or 'caption'." };
  }
  if (mode === "text") {
    if (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) {
      return { ok: false, status: 400, error: "text mode requires a profile object." };
    }
    return { ok: true };
  }
  if (mode === "caption") {
    if (typeof body.caption !== "string" || !body.caption.trim()) {
      return { ok: false, status: 400, error: "caption mode requires a non-empty caption string." };
    }
    if (body.caption.length > 2000) {
      return { ok: false, status: 413, error: "Caption too long (max 2000 characters)." };
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
  if (!images.every(item => typeof item === "string")) {
    return { ok: false, status: 400, error: "Each image must be a base64 string." };
  }
  const total = images.reduce((n, s) => n + (typeof s === "string" ? s.length : 0), 0);
  if (total > MAX_TOTAL_B64) {
    return { ok: false, status: 413, error: "Images too large — remove one and try again." };
  }
  return { ok: true };
}

const INFERENCE_ITEM = {
  type: "OBJECT",
  properties: {
    id: { type: "STRING" },
    severity: { type: "INTEGER", minimum: 1, maximum: 25 },
    category: { type: "STRING", enum: ["schedule","identity","physical","location","account","emotional","general"] },
    title: { type: "STRING" },
    summary: { type: "STRING" },
    explain: { type: "STRING" },
    chain: { type: "ARRAY", items: { type: "STRING" }, minItems: 2, maxItems: 4 }
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

const CAPTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    attackerView: { type: "STRING" },
    safeAlternative: { type: "STRING" },
    explanation: { type: "STRING" }
  },
  required: ["attackerView", "safeAlternative", "explanation"]
};

const CAPTION_SYSTEM = `You are a cybersecurity privacy expert acting as a safe-posting filter for teenagers. Rewrite the user's social-media caption to be safe from online predators while keeping the original teen tone, slang, and emojis. Strip real-time locations, exact routines, school/team names, and identifiable details; neutralise emotional vulnerability. Respond with three fields: attackerView (one sentence on what a predator infers from the ORIGINAL caption), safeAlternative (the rewritten predator-safe caption), explanation (a short why-the-original-was-risky note).`;

const TEXT_SYSTEM = `You are a child-safety analyst running an educational simulator. The user submitted a deliberately fake teen social profile. Enumerate the specific inferences a predator could draw, grounded ONLY in the fields provided. Never invent facts. Output 4-8 distinct inferences ranked by severity (1-25). Each inference's chain must cite the exact field values used. Each chain's final step must start with "→" and state the predator's conclusion.`;

const PHOTO_SYSTEM = `You are a child-safety analyst running an educational simulator. The user uploaded one or more (fictional/sample) images a teen might post publicly. These may be plain photos OR screenshots of social posts (e.g. Instagram) where on-screen text is visible. First, in "extracted", list every concrete detail visible across ALL images as {label, value} pairs — combine clues across images. Read and include BOTH: (a) any on-screen UI text — username/handle, display name, caption, hashtags, location tag, timestamp, commenter usernames, comment text; and (b) physical scene details — school crest, street sign, sports kit, house number, reflections, time-of-day, recognisable landmarks. Then in "inferences", enumerate 4-8 specific things a predator could conclude, ranked by severity (1-25), each chain citing which visible detail(s) it used and ending with a "→" conclusion. Ground everything ONLY in what is actually visible/legible. Never invent.`;

export function buildGeminiBody({ mode, profile, images, caption }) {
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
  if (mode === "caption") {
    return {
      systemInstruction: { parts: [{ text: CAPTION_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: `Rewrite this caption:\n\n${caption}` }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: CAPTION_SCHEMA, temperature: 0.7 }
    };
  }
  // photo
  const parts = [{ text: "Analyse these images together. Fill extracted[] with observable details, then inferences[] as instructed." }];
  for (const data of (images ?? [])) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
  return {
    systemInstruction: { parts: [{ text: PHOTO_SYSTEM }] },
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: PHOTO_SCHEMA, temperature: 0.6 }
  };
}

const GEMINI_MODEL = "gemini-2.5-flash";

export async function runAnalysis(input, { apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) {
    const err = new Error("Server is missing GEMINI_API_KEY.");
    err.status = 500;
    throw err;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(buildGeminiBody(input))
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`Gemini ${res.status}: ${txt.slice(0, 500)}`);
    const err = new Error("Upstream analysis service error.");
    err.status = 502;
    throw err;
  }
  const json = await res.json();
  return input.mode === "caption" ? normalizeCaption(json) : normalizeResult(json);
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
    // Never echo server-side (5xx) detail to the client; only client-error (4xx) messages are safe.
    const message = status >= 500 ? "Analysis failed. Please try again." : (e.message || "Analysis failed.");
    return res.status(status).json({ error: message });
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

function parseGeminiText(geminiJson) {
  const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) { const e = new Error("Empty response from Gemini."); e.status = 502; throw e; }
  try { return JSON.parse(text); }
  catch { const e = new Error("Gemini returned non-JSON text."); e.status = 502; throw e; }
}

export function normalizeResult(geminiJson) {
  const parsed = parseGeminiText(geminiJson);
  const inferences = (Array.isArray(parsed.inferences) ? parsed.inferences : [])
    .filter(i => i && i.title && i.explain && Array.isArray(i.chain))
    .map(i => ({ ...i, severity: Math.max(1, Math.min(25, parseInt(i.severity, 10) || 5)) }))
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 8);
  const extracted = Array.isArray(parsed.extracted) ? parsed.extracted : [];
  return { inferences, extracted };
}

export function normalizeCaption(geminiJson) {
  const parsed = parseGeminiText(geminiJson);
  const out = {
    attackerView: String(parsed.attackerView ?? ""),
    safeAlternative: String(parsed.safeAlternative ?? ""),
    explanation: String(parsed.explanation ?? "")
  };
  if (!out.attackerView && !out.safeAlternative && !out.explanation) {
    const e = new Error("Caption analysis returned no usable fields.");
    e.status = 502;
    throw e;
  }
  return out;
}
