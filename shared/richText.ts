/**
 * Minimal rich text for operator-written descriptions: `**words**` = bold, and
 * nothing else (no headings/links/colours — keeps every listing page uniform).
 * One parser shared by the React renderer (client/src/components/RichText.tsx),
 * the bot prerenderer (server/prerender.ts) and the length rules, so the three
 * always agree on what counts as bold. A marker never spans a line break, and
 * an unmatched `**` is left as typed.
 */

const BOLD = /\*\*(?=\S)([^\n]*?\S)\*\*/g;

export type RichSegment = { text: string; bold: boolean };

/** Split text into plain / bold runs. */
export function parseBold(text: string): RichSegment[] {
  const out: RichSegment[] = [];
  let last = 0;
  const re = new RegExp(BOLD.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const at = m.index;
    if (at > last) out.push({ text: text.slice(last, at), bold: false });
    out.push({ text: m[1], bold: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}

/** The text as a reader sees it — bold markers removed (for counts, snippets, meta). */
export function stripBold(text: string): string {
  return text.replace(BOLD, "$1");
}

/** HTML-escaped text → `<strong>` for bold runs. Input MUST already be escaped. */
export function boldToHtml(escaped: string): string {
  return escaped.replace(BOLD, "<strong>$1</strong>");
}
