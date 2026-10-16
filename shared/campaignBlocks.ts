/**
 * Campaign message blocks beyond plain Markdown — shared by the composer's
 * preview and the server's email builder, so what you see is what's sent.
 *
 * Buttons: a line on its own
 *     [[button: Explore what's new | https://revampvacations.com/explore]]
 *     [[button-outline: See all stays | https://revampvacations.com/explore/stay]]
 * renders as a centred, "bulletproof" call-to-action (a table cell with a
 * background colour + a padded link) — a real button in Gmail, Apple Mail and
 * Outlook alike, not an underlined link. Only https links; anything else stays
 * as plain text so a typo never produces a broken button.
 */
import { renderMarkdown } from "./markdown.js";

const BUTTON_LINE = /^\s*\[\[button(-outline)?:\s*(.+?)\s*\|\s*(\S+?)\s*\]\]\s*$/i;

export type ButtonStyle = "solid" | "outline";

/** The line the composer inserts for a button. */
export function buttonLine(label: string, url: string, style: ButtonStyle = "solid"): string {
  const clean = label.replace(/[|\]\n]/g, " ").replace(/\s+/g, " ").trim();
  return `[[button${style === "outline" ? "-outline" : ""}: ${clean} | ${url.trim()}]]`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function httpsOnly(u: string): string | null {
  try {
    const x = new URL(u);
    return x.protocol === "https:" ? x.toString() : null;
  } catch {
    return null;
  }
}

export function buttonHtml(label: string, url: string, style: ButtonStyle): string {
  const solid = style === "solid";
  const font = "font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;line-height:1.2;";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:22px auto;border-collapse:separate;"><tr><td align="center"${solid ? ' bgcolor="#F15822"' : ""} style="border-radius:999px;${solid ? "background:#F15822;" : ""}"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 32px;${font}${solid ? "color:#ffffff;border:2px solid #F15822;" : "color:#F15822;border:2px solid #F15822;"}text-decoration:none;border-radius:999px;">${esc(label)}</a></td></tr></table>`;
}

/**
 * Markdown + button lines → email HTML. `mapUrl` lets the server add tracking
 * (UTM) to button links the same way it does to ordinary links.
 */
export function renderCampaignBody(md: string, mapUrl: (u: string) => string = (u) => u): string {
  const out: string[] = [];
  let chunk: string[] = [];
  const flush = () => {
    if (chunk.length) out.push(renderMarkdown(chunk.join("\n")));
    chunk = [];
  };
  for (const line of (md || "").replace(/\r\n?/g, "\n").split("\n")) {
    const m = line.match(BUTTON_LINE);
    const url = m ? httpsOnly(m[3]) : null;
    if (m && url) {
      flush();
      out.push(buttonHtml(m[2], mapUrl(url), m[1] ? "outline" : "solid"));
    } else chunk.push(line);
  }
  flush();
  return out.join("\n");
}

/** For plain-text channels (Telegram): a button line becomes "Label: url" (`mapUrl` adds tracking). */
export function buttonsToText(md: string, mapUrl: (u: string) => string = (u) => u): string {
  return (md || "")
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(BUTTON_LINE);
      return m ? `${m[2]}: ${mapUrl(m[3])}` : line;
    })
    .join("\n");
}

/**
 * Campaign Markdown → Telegram plain text (shared by the composer preview and
 * the server send). Emphasis markers are only removed when they wrap words —
 * never inside a word, a URL or a merge tag — so "{first_name}" and links like
 * "?utm_source=telegram&utm_medium=…" survive intact (they didn't before
 * 2026-10-16: the old rule stripped every pair of underscores).
 */
export function markdownToTelegramText(src: string, mapUrl: (u: string) => string = (u) => u): string {
  // Set aside URLs and merge tags so the emphasis rules can't touch them.
  const kept: string[] = [];
  const keep = (s: string) => `\u0000${kept.push(s) - 1}\u0000`;
  let t = buttonsToText(src || "", mapUrl).replace(/\r\n?/g, "\n");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // images: drop
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => `${label} (${keep(url)})`); // links: label (url)
  t = t.replace(/https?:\/\/[^\s)]+/g, (u) => keep(u)); // bare URLs (incl. button "Label: url")
  t = t.replace(/\{\s*[a-z_]+\s*\}/gi, (tag) => keep(tag)); // {first_name}
  t = t
    .replace(/^#{1,6}\s*/gm, "") // headings
    .replace(/^>\s?/gm, "") // blockquotes
    .replace(/\*\*([^*\n]+)\*\*/g, "$1") // bold
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,!?;:)]|$)/gm, "$1$2") // *italic* around words
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,!?;:)]|$)/gm, "$1$2") // _italic_ around words
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1") // code
    .replace(/^\s*[-*]\s+/gm, "• ") // bullets
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.replace(/\u0000(\d+)\u0000/g, (_m, i) => kept[Number(i)]);
}

export interface TelegramButton {
  text: string;
  url: string;
}

const escTg = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Campaign Markdown → Telegram HTML (parse_mode "HTML": only <b> <i> <a> <code>)
 * + inline buttons. `[[button: …]]` lines (https only) become real tappable
 * buttons under the message; `[label](url)` becomes a tappable "label" with the
 * (tracked) URL hidden inside — no long utm addresses on show. All text is
 * escaped first, so a message can't inject markup. `{first_name}` stays as-is
 * (the sender personalizes with an ESCAPED name).
 */
export function markdownToTelegramHtml(src: string, mapUrl: (u: string) => string = (u) => u): { html: string; buttons: TelegramButton[] } {
  const buttons: TelegramButton[] = [];
  const lines: string[] = [];
  for (const line of (src || "").replace(/\r\n?/g, "\n").split("\n")) {
    const m = line.match(BUTTON_LINE);
    const url = m ? httpsOnly(m[3]) : null;
    if (m && url) buttons.push({ text: m[2].slice(0, 60), url: mapUrl(url) });
    else lines.push(line);
  }
  const kept: string[] = [];
  const keep = (s: string) => `\u0000${kept.push(s) - 1}\u0000`;
  let t = lines.join("\n");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // images: drop
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const safe = httpsOnly(url) ?? (/^http:\/\//i.test(url) ? url : null);
    return safe ? keep(`<a href="${escTg(mapUrl(safe)).replace(/"/g, "&quot;")}">${escTg(label)}</a>`) : `${label} (${url})`;
  });
  t = t.replace(/https?:\/\/[^\s)<]+/g, (u) => keep(escTg(u))); // bare URLs: Telegram links them
  t = t.replace(/\{\s*[a-z_]+\s*\}/gi, (tag) => keep(tag)); // {first_name}
  t = escTg(t);
  t = t
    .replace(/^#{1,6}\s*(.+)$/gm, "<b>$1</b>") // headings → bold line
    .replace(/^&gt;\s?/gm, "") // blockquotes
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,!?;:)]|$)/gm, "$1<i>$2</i>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,!?;:)]|$)/gm, "$1<i>$2</i>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { html: t.replace(/\u0000(\d+)\u0000/g, (_m, i) => kept[Number(i)]), buttons };
}

/** The bold first line + body, as the bot sends it. */
export function telegramMessageHtml(subject: string, bodyHtml: string): string {
  const first = escTg(subject.trim());
  return first ? `<b>${first}</b>\n\n${bodyHtml}` : bodyHtml;
}

