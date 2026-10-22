/**
 * Should a block of reviews offer "Translate"? (ExternalReviews.tsx)
 */
// A quick, free check in the browser (no API call): show the button only when
// some review is likely NOT in the visitor's language — another alphabet
// (Armenian / Cyrillic vs Latin), or Latin text that isn't English when the
// visitor reads English, or English text when the visitor's browser is in
// another Latin-alphabet language.
type Script = "armenian" | "cyrillic" | "latin" | "other";
const ARMENIAN = /[\u0531-\u058F]/g;
const CYRILLIC = /[\u0400-\u04FF]/g;
const LATIN = /[A-Za-z\u00C0-\u024F]/g;
function scriptOf(text: string): Script {
  const n = (re: RegExp) => (text.match(re) ?? []).length;
  const counts: [Script, number][] = [["armenian", n(ARMENIAN)], ["cyrillic", n(CYRILLIC)], ["latin", n(LATIN)]];
  const [best, count] = counts.sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : "other";
}
const EN_WORDS = new Set(["the", "and", "was", "is", "to", "very", "great", "we", "it", "of", "with", "for", "place", "stay", "host", "nice", "good", "clean"]);
/** Latin text that reads as English (common English words, no accented letters). */
function looksEnglish(text: string): boolean {
  if (/[\u00C0-\u024F]/.test(text)) return false;
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  return words.some((w) => EN_WORDS.has(w));
}
function viewerScript(lang: string): Script {
  if (lang === "hy") return "armenian";
  if (["ru", "uk", "be", "bg", "sr", "mk", "kk", "ky"].includes(lang)) return "cyrillic";
  return "latin";
}
export function reviewsNeedTranslation(texts: string[], viewerLang: string): boolean {
  const lang = (viewerLang || "en").slice(0, 2).toLowerCase();
  const mine = viewerScript(lang);
  return texts.some((t) => {
    const s = scriptOf(t);
    if (s === "other") return false; // emoji-only etc.
    if (s !== mine) return true;
    if (s !== "latin") return false; // same non-Latin alphabet → same language family, assume readable
    return lang === "en" ? !looksEnglish(t) : looksEnglish(t);
  });
}
