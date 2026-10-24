/**
 * Campaign banner maker — draws a 1200 × 600 brand banner on a canvas from a
 * headline, in the brandbook's look (same family as the "brand-cover" starter):
 * the `revamp.` wordmark top-left, a big headline (optional last line in the
 * accent colour), an optional eyebrow and subline, the large cropped `re.`
 * pattern, and a small site line at the bottom.
 *
 * The logo and pattern are the brandbook's own outlines (shared/brandLogo.ts) —
 * never retyped as text. Headline type is Manrope (Circular Std isn't licensed
 * for web text; see CLAUDE.md), with Noto Sans Armenian for Armenian letters.
 * Brand colours only: orange #F15822, charcoal #212121, white.
 */
import { RE_PATH, RE_RATIO, WORDMARK_PATH } from "@shared/brandLogo";

export const BANNER_W = 1200;
export const BANNER_H = 600;
export const HEADLINE_MAX = 70;
export const EYEBROW_MAX = 40;
export const SUBLINE_MAX = 100;

const ORANGE = "#F15822";
const CHARCOAL = "#212121";
const WHITE = "#FFFFFF";

export type BannerTheme = "paper" | "charcoal" | "orange";
export type BannerPattern = "right" | "behind" | "none";

export const BANNER_THEMES: { value: BannerTheme; label: string; swatch: string }[] = [
  { value: "paper", label: "White", swatch: WHITE },
  { value: "charcoal", label: "Charcoal", swatch: CHARCOAL },
  { value: "orange", label: "Orange", swatch: ORANGE },
];
export const BANNER_PATTERNS: { value: BannerPattern; label: string }[] = [
  { value: "right", label: "re. on the right" },
  { value: "behind", label: "re. behind the text" },
  { value: "none", label: "No pattern" },
];

export interface BannerSpec {
  theme: BannerTheme;
  pattern: BannerPattern;
  eyebrow: string;
  headline: string;
  /** Colour the headline's last line with the accent (orange; charcoal on the orange theme). */
  accentLastLine: boolean;
  subline: string;
  showSite: boolean;
  /** The `revamp.` wordmark top-left. Off for email (the email header already
   * shows it — two logos stacked looked doubled); on for Telegram etc. */
  showLogo: boolean;
}

export const DEFAULT_BANNER: BannerSpec = {
  theme: "paper",
  pattern: "right",
  eyebrow: "",
  headline: "",
  accentLastLine: true,
  subline: "",
  showSite: true,
  showLogo: false,
};

const PALETTE: Record<BannerTheme, { bg: string; text: string; accent: string; soft: string; logo: string; pattern: string; patternAlpha: number }> = {
  paper: { bg: WHITE, text: CHARCOAL, accent: ORANGE, soft: "rgba(33,33,33,0.62)", logo: ORANGE, pattern: ORANGE, patternAlpha: 0.12 },
  charcoal: { bg: CHARCOAL, text: WHITE, accent: ORANGE, soft: "rgba(255,255,255,0.72)", logo: WHITE, pattern: WHITE, patternAlpha: 0.07 },
  orange: { bg: ORANGE, text: WHITE, accent: CHARCOAL, soft: "rgba(255,255,255,0.86)", logo: WHITE, pattern: WHITE, patternAlpha: 0.16 },
};

const PAD = 80;
const FONT = `Manrope, "Noto Sans Armenian", ui-sans-serif, system-ui, sans-serif`;

/** Make sure the web fonts are ready before drawing (canvas won't wait for them). */
export async function loadBannerFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`800 96px Manrope`),
      document.fonts.load(`600 24px Manrope`),
      document.fonts.load(`700 96px "Noto Sans Armenian"`, "Հ"),
    ]);
  } catch {
    /* fall back to system fonts rather than fail */
  }
}

/** Word-wrap one paragraph to a width (a single word longer than the width stays whole). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The headline's lines and size: the biggest size (112 → 44 px) where it fits in ≤3 lines and the space left. */
function fitHeadline(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxHeight: number): { lines: string[]; size: number } {
  const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  let best = { lines: [] as string[], size: 44 };
  for (let size = 112; size >= 44; size -= 4) {
    ctx.font = `800 ${size}px ${FONT}`;
    const lines = paragraphs.flatMap((p) => wrap(ctx, p, maxWidth));
    best = { lines, size };
    const tooWide = lines.some((l) => ctx.measureText(l).width > maxWidth);
    if (lines.length <= 3 && !tooWide && lines.length * size * 1.04 <= maxHeight) return best;
  }
  return best;
}

function drawPath(ctx: CanvasRenderingContext2D, d: string, x: number, y: number, scale: number, color: string, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(d));
  ctx.restore();
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  // Canvas letterSpacing (Chrome 99+, Safari 17+); older browsers just skip it.
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** Draw the banner. The canvas must be BANNER_W × BANNER_H. */
export function drawBanner(canvas: HTMLCanvasElement, spec: BannerSpec): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const c = PALETTE[spec.theme];
  ctx.clearRect(0, 0, BANNER_W, BANNER_H);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, BANNER_W, BANNER_H);

  // The large cropped re. — a brandbook device, kept faint so the headline leads.
  if (spec.pattern !== "none") {
    const h = spec.pattern === "right" ? 560 : 400;
    const scale = h / 92.94; // RE_VIEWBOX height
    const w = h * RE_RATIO;
    const x = spec.pattern === "right" ? BANNER_W - w * 0.62 : PAD - 30;
    const y = spec.pattern === "right" ? BANNER_H - h * 0.78 : BANNER_H - h * 0.86;
    drawPath(ctx, RE_PATH, x, y, scale, c.pattern, c.patternAlpha);
  }

  // Wordmark, top-left (one colour, never recoloured per letter).
  const logoH = 40;
  if (spec.showLogo) drawPath(ctx, WORDMARK_PATH, PAD, 64, logoH / 188.13, c.logo); // 188.13 = WORDMARK_VIEWBOX height

  const textW = BANNER_W - PAD * 2 - (spec.pattern === "right" ? 120 : 0);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Measure the stack (eyebrow · headline · subline) and centre it in the space
  // between the wordmark and the site line.
  const top = spec.showLogo ? 64 + logoH + 40 : 64;
  const bottom = spec.showSite ? BANNER_H - 96 : BANNER_H - 64;
  // Written as typed — never forced to capitals: the brand is lowercase (`revamp.`).
  const eyebrow = spec.eyebrow.trim();
  const subline = spec.subline.trim();
  const eyebrowH = eyebrow ? 22 + 20 : 0;
  ctx.font = `500 28px ${FONT}`;
  const subLines = subline ? wrap(ctx, subline, textW).slice(0, 2) : [];
  const subH = subLines.length ? 24 + subLines.length * 38 : 0;
  const head = fitHeadline(ctx, spec.headline.trim() || "Your headline", textW, bottom - top - eyebrowH - subH);
  const lineH = Math.round(head.size * 1.04);
  const stackH = eyebrowH + head.lines.length * lineH + subH;
  let y = top + Math.max(0, (bottom - top - stackH) / 2);

  if (eyebrow) {
    ctx.font = `700 24px ${FONT}`;
    setSpacing(ctx, 0.3);
    ctx.fillStyle = spec.theme === "paper" ? ORANGE : c.soft;
    ctx.fillText(eyebrow, PAD, y + 22);
    setSpacing(ctx, 0);
    y += eyebrowH;
  }

  ctx.font = `800 ${head.size}px ${FONT}`;
  setSpacing(ctx, -head.size * 0.02);
  head.lines.forEach((line, i) => {
    const last = i === head.lines.length - 1;
    ctx.fillStyle = spec.accentLastLine && last && head.lines.length > 1 ? c.accent : c.text;
    ctx.fillText(line, PAD, y + lineH * (i + 1) - Math.round(head.size * 0.12));
  });
  setSpacing(ctx, 0);
  y += head.lines.length * lineH;

  if (subLines.length) {
    ctx.font = `500 28px ${FONT}`;
    ctx.fillStyle = c.soft;
    subLines.forEach((l, i) => ctx.fillText(l, PAD, y + 24 + 30 + i * 38));
  }

  if (spec.showSite) {
    ctx.font = `600 22px ${FONT}`;
    setSpacing(ctx, 0.3);
    ctx.fillStyle = c.soft;
    ctx.fillText("revampvacations.com · Armenia", PAD, BANNER_H - 56);
    setSpacing(ctx, 0);
  }
}

/** Alt text for the banner: the words that are in the picture (inboxes often hide images). */
export function bannerAlt(spec: BannerSpec): string {
  return [spec.eyebrow, spec.headline.replace(/\s*\n\s*/g, " "), spec.subline].map((s) => s.trim()).filter(Boolean).join(" — ").slice(0, 200);
}
