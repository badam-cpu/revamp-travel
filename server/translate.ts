/**
 * Text translation via the Google Cloud Translation API (v2 REST). Used by the
 * "Translate reviews" toggle so a guest can read non-English external reviews.
 * Server-side (key hidden) + cached (translations are stable, so we keep them in
 * memory and never re-pay for the same text→target). Opt-in from the client, so
 * we only ever translate what a viewer asked to see.
 *
 * Key: GOOGLE_TRANSLATE_API_KEY (Cloud Translation API enabled), falling back to
 * GOOGLE_PLACES_API_KEY if that key also has Translation enabled + no referrer
 * restriction.
 */
export interface Translated {
  text: string;
  detected: string;
}

const cache = new Map<string, Translated>();
const MAX_CACHE = 5000;

function key(): string | undefined {
  return process.env.GOOGLE_TRANSLATE_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
}

export function translateConfigured(): boolean {
  return !!key();
}

/** Translate an array of texts to `target`. Returns one result per input (same
 *  order). Cached hits are free; only uncached texts hit the API. Never throws —
 *  on failure a text falls back to itself (detected ""). */
export async function translateTexts(texts: string[], target = "en"): Promise<Translated[]> {
  const apiKey = key();
  const results: (Translated | null)[] = texts.map((t) => {
    const c = cache.get(`${target}|${t}`);
    return c ?? null;
  });
  const missingIdx = results.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
  if (!apiKey || missingIdx.length === 0) {
    return results.map((r, i) => r ?? { text: texts[i], detected: "" });
  }

  try {
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: missingIdx.map((i) => texts[i]), target, format: "text" }),
    });
    const json = (await res.json()) as { data?: { translations?: { translatedText?: string; detectedSourceLanguage?: string }[] } };
    const translations = json.data?.translations ?? [];
    missingIdx.forEach((origIdx, k) => {
      const tr = translations[k];
      const value: Translated = { text: tr?.translatedText ?? texts[origIdx], detected: tr?.detectedSourceLanguage ?? "" };
      results[origIdx] = value;
      if (cache.size < MAX_CACHE) cache.set(`${target}|${texts[origIdx]}`, value);
    });
  } catch (err) {
    console.error("[translate] failed", err);
  }
  return results.map((r, i) => r ?? { text: texts[i], detected: "" });
}
