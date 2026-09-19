/**
 * Minimal, dependency-free Markdown → safe HTML, for admin-authored blog posts
 * (see supabase/migrations/0030_posts.sql, AdminBlog.tsx, Blog/BlogPost pages,
 * and server/prerender.ts). Shared so the React render and the bot prerender
 * emit identical HTML.
 *
 * Safety: the ENTIRE source is HTML-escaped first, so no raw HTML or <script>
 * can survive — we then emit only a fixed set of tags, and every link/image URL
 * is passed through safeUrl() (http/https/mailto/root-relative only). This is
 * deliberately not full CommonMark; it covers headings, bold/italic, inline
 * code, links, images, blockquotes, ordered/unordered lists, fenced code, rules
 * and paragraphs — enough for a blog, with no parser dependency to lockfile.
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeUrl(url: string): string {
  const u = url.trim();
  // Allow absolute http(s), mailto, and root-relative links only.
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u) || /^\//.test(u)) return u;
  return "#";
}

/** Inline spans. `text` is already HTML-escaped. */
function inline(text: string): string {
  let t = text;
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, u) => `<img src="${safeUrl(u)}" alt="${alt}" loading="lazy" />`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, u) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  return t;
}

export function renderMarkdown(src: string): string {
  if (!src) return "";
  const lines = escapeHtml(src.replace(/\r\n/g, "\n")).split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushPara();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      out.push("<hr />");
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushPara();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara();
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*[-*+]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${buf.join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${buf.join("")}</ol>`);
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return out.join("\n");
}

/** Plain-text excerpt fallback: strip Markdown syntax, collapse whitespace. */
export function markdownToPlain(src: string, max = 160): string {
  const text = (src || "")
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}
