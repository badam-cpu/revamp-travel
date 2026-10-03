/**
 * audit-image-resolution.ts — find listings whose photos are too low-resolution.
 *
 * WHY: the responsive image ladder (client/src/lib/imageUpload.ts) can downscale
 * a big photo but never add detail, so a small SOURCE renders blurry on the
 * full-width/retina hero. Some listings were uploaded from genuinely tiny
 * sources (e.g. Tava Restaurant's cover is only 547px wide), which is why those
 * heroes look soft while others are crisp. This probes the ACTUAL pixel
 * dimensions of every listing's images and reports the ones that need a
 * higher-res re-upload — so you fix the right listings, not guess.
 *
 * It reads the images' real dimensions by fetching only the file header (no image
 * library, no full download) and parsing WebP / JPEG / PNG.
 *
 * RUN:
 *   pnpm audit:images
 * which is `tsx --env-file=.env scripts/audit-image-resolution.ts`. Needs
 * VITE_SUPABASE_URL (or SUPABASE_URL) and a key in .env: SUPABASE_SERVICE_ROLE_KEY
 * sees every listing (drafts included); the anon key sees only published ones.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const key = serviceKey || anonKey;

const MIN_LONG_EDGE = 1280; // keep in sync with PhotoUploader's guard

if (!url || !key) {
  console.error("Missing Supabase env. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or the anon key) in .env.");
  process.exit(1);
}

type Dims = { w: number; h: number };

/** Parse width/height from the first bytes of a PNG / JPEG / WebP file. */
function parseDimensions(buf: Buffer): Dims | null {
  // PNG: 8-byte sig, then IHDR with width@16, height@20 (big-endian).
  if (buf.length >= 24 && buf.toString("ascii", 1, 4) === "PNG") {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // WebP: 'RIFF'....'WEBP' then RIFF chunks. We must read the REAL frame
  // dimensions from the VP8 / VP8L chunk — NOT the VP8X "canvas" header, which
  // legacy uploads mislabel (e.g. a 721px image wrapped in a VP8X claiming 2560).
  if (buf.length >= 16 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    let vp8x: Dims | null = null;
    let off = 12;
    while (off + 8 <= buf.length) {
      const cc = buf.toString("ascii", off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      const p = off + 8; // payload start
      if (cc === "VP8 " && p + 10 <= buf.length) {
        // lossy keyframe: 3-byte frame tag, 3-byte start code, then 14-bit w, 14-bit h
        return { w: buf.readUInt16LE(p + 6) & 0x3fff, h: buf.readUInt16LE(p + 8) & 0x3fff };
      }
      if (cc === "VP8L" && p + 5 <= buf.length) {
        // lossless: 0x2f signature, then 14-bit (w-1), 14-bit (h-1)
        const bits = buf[p + 1] | (buf[p + 2] << 8) | (buf[p + 3] << 16) | (buf[p + 4] << 24);
        return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (cc === "VP8X" && p + 10 <= buf.length) {
        // remember the canvas as a last resort, but keep scanning for the real frame
        vp8x = { w: (buf[p + 4] | (buf[p + 5] << 8) | (buf[p + 6] << 16)) + 1, h: (buf[p + 7] | (buf[p + 8] << 8) | (buf[p + 9] << 16)) + 1 };
      }
      off = p + size + (size & 1); // chunks are padded to an even length
    }
    return vp8x; // only reached if the VP8/VP8L frame wasn't in the fetched header window
  }
  // JPEG: scan segments for a Start-Of-Frame marker (SOF0..SOF15, skip non-SOF).
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = buf[o + 1];
      const len = buf.readUInt16BE(o + 2);
      // SOF markers carrying dimensions (exclude DHT/DAC/RST/SOS etc.)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      }
      o += 2 + len;
    }
  }
  return null;
}

/** Fetch just enough of an image to read its header, then parse dimensions. */
async function probe(imgUrl: string): Promise<Dims | null> {
  try {
    let res = await fetch(imgUrl, { headers: { Range: "bytes=0-262143" } }); // first 256 KB
    if (!res.ok && res.status !== 206) res = await fetch(imgUrl); // retry without range
    if (!res.ok && res.status !== 206) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return parseDimensions(buf);
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

type Row = { id: string; slug: string; title: string; type: string; status: string; image: string | null; gallery: string[] | null };

async function main() {
  const supabase = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`\nAuditing image resolution (flagging long edge < ${MIN_LONG_EDGE}px)…`);
  console.log(`Using ${serviceKey ? "service-role key (all listings)" : "anon key (published only)"}.\n`);

  const rows: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("listings")
      .select("id, slug, title, type, status, image, gallery")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("Query failed:", error.message);
      process.exit(1);
    }
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }

  const flagged: { title: string; type: string; status: string; slug: string; coverLong: number | null; worst: number | null; smallCount: number; total: number }[] = [];

  for (const r of rows) {
    const images = Array.from(new Set([r.image, ...(r.gallery ?? [])].filter(Boolean))) as string[];
    if (images.length === 0) continue;
    const dims = await mapLimit(images, 6, probe);
    const longs = dims.map((d) => (d ? Math.max(d.w, d.h) : null));
    const coverLong = longs[0] ?? null;
    const measured = longs.filter((n): n is number => n != null);
    const worst = measured.length ? Math.min(...measured) : null;
    const smallCount = measured.filter((n) => n < MIN_LONG_EDGE).length;
    const coverTooSmall = coverLong != null && coverLong < MIN_LONG_EDGE;
    if (coverTooSmall || smallCount > 0) {
      flagged.push({ title: r.title, type: r.type, status: r.status, slug: r.slug, coverLong, worst, smallCount, total: images.length });
    }
  }

  flagged.sort((a, b) => (a.coverLong ?? 1e9) - (b.coverLong ?? 1e9));

  if (flagged.length === 0) {
    console.log(`✅ No low-resolution listings found across ${rows.length} listings. All covers are ≥ ${MIN_LONG_EDGE}px.\n`);
    return;
  }

  console.log(`⚠️  ${flagged.length} of ${rows.length} listings have at least one low-res photo (worst first):\n`);
  console.log("cover px | low/total | type        | status     | listing");
  console.log("---------+-----------+-------------+------------+------------------------------------");
  for (const f of flagged) {
    const cover = (f.coverLong != null ? `${f.coverLong}` : "?").padStart(8);
    const ratio = `${f.smallCount}/${f.total}`.padStart(9);
    const type = (f.type || "").padEnd(11);
    const status = (f.status || "").padEnd(10);
    console.log(`${cover} | ${ratio} | ${type} | ${status} | ${f.title}  (/listing/${f.slug})`);
  }
  console.log(`\nCover px = long edge of the cover photo. "low/total" = images under ${MIN_LONG_EDGE}px / total images.`);
  console.log("Re-upload 2000px+ originals for these (worst/top ones first). '?' = couldn't decode the header.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
