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
 *
 * Images (2026-10-22): a line on its own
 *     [[image: https://…/photo.jpg | Alt text | https://optional-link]]
 * places a full-width picture anywhere in the message (not only the layout's
 * one image at the top) — the same responsive <img> the layout uses.
 *
 * Stats (2026-10-22): a line on its own
 *     [[stat: 22% | of travelers who saw similar listings clicked "Book later"]]
 * renders as a number card (big orange number, short label). Stat lines with
 * nothing but blank lines between them sit side by side, up to 3 in a row — real text, so they read with
 * images off and on every screen. On Telegram both become plain lines.
 */
import { renderMarkdown } from "./markdown.js";

const BUTTON_LINE = /^\s*\[\[button(-outline)?:\s*(.+?)\s*\|\s*(\S+?)\s*\]\]\s*$/i;
const IMAGE_LINE = /^\s*\[\[image:\s*(\S+?)\s*(?:\|\s*([^|\]]*?)\s*)?(?:\|\s*(\S+?)\s*)?\]\]\s*$/i;
const STAT_LINE = /^\s*\[\[stat:\s*([^|\]]{1,16}?)\s*\|\s*([^\]]{1,160}?)\s*\]\]\s*$/i;

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

/** The line the composer inserts for an image. */
export function imageLine(src: string, alt: string, link?: string | null): string {
  const clean = (t: string) => t.replace(/[|\]\n]/g, " ").replace(/\s+/g, " ").trim();
  return `[[image: ${src.trim()} | ${clean(alt)}${link?.trim() ? ` | ${link.trim()}` : ""}]]`;
}

/** The line the composer inserts for a stat card. */
export function statLine(value: string, label: string): string {
  const clean = (t: string) => t.replace(/[|\]\n]/g, " ").replace(/\s+/g, " ").trim();
  return `[[stat: ${clean(value).slice(0, 16)} | ${clean(label).slice(0, 160)}]]`;
}

export function imageHtml(src: string, alt: string, link: string | null): string {
  const tag = `<img src="${esc(src)}" alt="${esc(alt)}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:10px;margin:0;" />`;
  const inner = link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" style="display:block;">${tag}</a>` : tag;
  return `<div style="margin:22px 0;">${inner}</div>`;
}

/**
 * 1–3 number cards in one row (an email-safe table). Gaps are spacer cells, not
 * border-spacing, so the cards line up with the text's left and right edges.
 */
export function statsHtml(stats: { value: string; label: string }[]): string {
  const gap = 2; // % of the row between cards
  const w = Math.floor((100 - gap * (stats.length - 1)) / stats.length);
  const spacer = `<td width="${gap}%" style="font-size:0;line-height:0;">&nbsp;</td>`;
  const cells = stats
    .map(
      (st) =>
        `<td class="rv-stat" width="${w}%" valign="top" style="background:#FDF1EB;border-radius:12px;padding:16px 16px 18px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;"><div style="font-size:32px;line-height:1.05;font-weight:800;letter-spacing:-.02em;color:#F15822;">${esc(st.value)}</div><div style="margin-top:6px;font-size:13px;line-height:1.45;color:#4a463f;">${esc(st.label)}</div></td>`,
    )
    .join(spacer);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;margin:18px 0;"><tr>${cells}</tr></table>`;
}

/** Image/stat lines → plain text lines (Telegram): images dropped, a stat as "**22%** — label". */
function blocksToText(md: string): string {
  return (md || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => {
      if (IMAGE_LINE.test(line)) return [];
      const st = line.match(STAT_LINE);
      return [st ? `**${st[1]}** — ${st[2]}` : line];
    })
    .join("\n");
}

/**
 * The inbox preview line (the grey text after the subject): what the admin
 * typed, else the message's first real sentence — never a greeting line, a
 * button, an image or a stat.
 */
export function defaultPreheader(md: string): string {
  const lines = blocksToText(md)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !BUTTON_LINE.test(l) && !/^#{1,6}\s/.test(l));
  const body = lines.filter((l, i) => !(i === 0 && /,$/.test(l) && l.length < 40)); // skip "Hi {first_name},"
  const text = body
    .join(" ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 140) return text;
  const cut = text.slice(0, 140);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 100)).trim()}…`;
}

/**
 * Hidden inbox preview text + a run of invisible spacers, so mail apps show
 * only this and never pull in the header/body text (or any hidden marker) after it.
 */
export function preheaderHtml(text: string): string {
  const filler = "&#8199;&#65279;&#847;".repeat(80);
  return `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all;">${esc(text)}${filler}</div>`;
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
  let stats: { value: string; label: string }[] = [];
  const flushStats = () => {
    for (let i = 0; i < stats.length; i += 3) out.push(statsHtml(stats.slice(i, i + 3)));
    stats = [];
  };
  for (const line of (md || "").replace(/\r\n?/g, "\n").split("\n")) {
    const st = line.match(STAT_LINE);
    if (st) {
      flush();
      stats.push({ value: st[1], label: st[2] });
      continue;
    }
    // Stats separated only by blank lines still share a row (the composer adds
    // each block with a blank line around it).
    if (stats.length && !line.trim()) continue;
    flushStats();
    const m = line.match(BUTTON_LINE);
    const url = m ? httpsOnly(m[3]) : null;
    const im = line.match(IMAGE_LINE);
    const src = im ? httpsOnly(im[1]) : null;
    if (m && url) {
      flush();
      out.push(buttonHtml(m[2], mapUrl(url), m[1] ? "outline" : "solid"));
    } else if (im && src) {
      flush();
      const link = im[3] ? httpsOnly(im[3]) : null;
      out.push(imageHtml(src, im[2] ?? "", link ? mapUrl(link) : null));
    } else chunk.push(line);
  }
  flush();
  flushStats();
  return out.join("\n");
}

/** For plain-text channels (Telegram): a button line becomes "Label: url" (`mapUrl` adds tracking). */
export function buttonsToText(md: string, mapUrl: (u: string) => string = (u) => u): string {
  return blocksToText(md)
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
  for (const line of blocksToText(src).split("\n")) {
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

// ── Campaign email footer ───────────────────────────────────────────────────
// The website's closing band, for campaign emails — kept quiet so the message
// and its button lead: charcoal, the slogan small (never reworded —
// "Experience." in orange; the header already carries the `revamp.`
// wordmark, so it isn't repeated), four links into the site incl. the Blog,
// social channels, the legal line and Unsubscribe. Links are separated by
// spacing (with a real space) so the row wraps on phones. Shared by the
// server's email builder and the composer preview.

/** Social channels shown in the footer (same as the website footer). */
export const BRAND_SOCIALS: { label: string; url: string }[] = [{ label: "Instagram", url: "https://www.instagram.com/revamphomes_yerevan/" }];
export const BRAND_CONTACT_EMAIL = "hello@revampvacations.com";
/**
 * Business postal address — marketing email should carry one (e.g. US
 * CAN-SPAM). Null until it's provided; the footer simply leaves it out.
 */
export const BRAND_POSTAL_ADDRESS: string | null = "Northern Ave 1, Yerevan, Armenia";

const FOOTER_LINKS: [string, string][] = [
  ["Stays", "/explore/stay"],
  ["Tours", "/explore/tour"],
  ["Experiences", "/explore/experience"],
  ["Blog", "/blog"],
];

export function campaignFooterHtml(o: { siteUrl: string; unsubUrl: string; sentLabel: string; mapUrl?: (u: string) => string; year?: number; recipient?: string | null }): string {
  const map = o.mapUrl ?? ((u: string) => u);
  const site = o.siteUrl.replace(/\/+$/, "");
  // `inner` is trusted HTML built here; every outside value goes through esc().
  const a = (href: string, inner: string, color = "#ffffff", extra = "") =>
    `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" style="color:${color};text-decoration:none;${extra}">${inner}</a>`;
  // Space, not dots, between links: no separator left dangling at the end of
  // a wrapped line, and nothing for a screen reader to announce. The final
  // normal space is where the row can wrap.
  const gap = "&nbsp;&nbsp;&nbsp; ";
  const links = FOOTER_LINKS.map(([l, p]) => a(map(`${site}${p}`), esc(l), "#ffffff", "font-weight:600;")).join(gap);
  const soft = "rgba(255,255,255,.7)";
  const socials = [
    ...BRAND_SOCIALS.map((s) => a(s.url, `${esc(s.label)}<span aria-hidden="true">&nbsp;↗</span>`, soft)),
    a(`mailto:${BRAND_CONTACT_EMAIL}`, esc(BRAND_CONTACT_EMAIL), soft),
  ].join(gap);
  const muted = "font-size:12px;line-height:1.6;color:rgba(255,255,255,.55);margin:0;";
  return `<div style="background:#212121;padding:24px 28px 22px;color:#ffffff;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
  <p style="margin:0;font-weight:800;font-size:18px;line-height:1.1;letter-spacing:-.02em;color:#ffffff;">Stay.<br /><span style="color:#F15822;">Experience.</span><br />Repeat.</p>
  <p style="margin:18px 0 0;font-size:14px;line-height:1.8;color:#ffffff;">${links}</p>
  <p style="margin:4px 0 0;font-size:13px;line-height:1.8;color:${soft};">${socials}</p>
  <div style="border-top:1px solid rgba(255,255,255,.1);margin-top:18px;padding-top:14px;">
    <p style="${muted}">© ${o.year ?? new Date().getFullYear()} Revamp Hospitality LLC${BRAND_POSTAL_ADDRESS ? ` · ${esc(BRAND_POSTAL_ADDRESS)}` : ""} · ${esc(o.sentLabel)}</p>
    ${o.recipient ? `<p style="${muted}">This email was sent to ${esc(o.recipient)}.</p>` : ""}
    <p style="${muted}">Don't want these emails? <a href="${esc(o.unsubUrl)}" style="color:${soft};text-decoration:underline;">Unsubscribe</a>.</p>
  </div>
</div>`;
}

