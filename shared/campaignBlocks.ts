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

/** For plain-text channels (Telegram): a button line becomes "Label: url". */
export function buttonsToText(md: string): string {
  return (md || "")
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(BUTTON_LINE);
      return m ? `${m[2]}: ${m[3]}` : line;
    })
    .join("\n");
}
