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
    if (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) {
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
  if (!images.every(item => typeof item === "string")) {
    return { ok: false, status: 400, error: "Each image must be a base64 string." };
  }
  const total = images.reduce((n, s) => n + (typeof s === "string" ? s.length : 0), 0);
  if (total > MAX_TOTAL_B64) {
    return { ok: false, status: 413, error: "Images too large — remove one and try again." };
  }
  return { ok: true };
}
