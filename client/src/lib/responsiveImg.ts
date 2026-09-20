/**
 * Turn a stored image URL into responsive <img> props. Photos uploaded via
 * client/src/lib/imageUpload.ts are stored as a ladder of WebP variants named
 * `<uuid>_w<width>.webp`, and the URL we keep is the largest one. This reads the
 * `_w<max>` token and builds a `srcset` of the ladder widths that exist (all
 * steps ≤ the stored max), so the browser downloads the resolution that fits the
 * slot and the device pixel ratio — the Airbnb pattern.
 *
 * Anything without the token (older single-file uploads, brand /images/*.svg,
 * pasted third-party URLs) is returned as a plain `src` with no srcset, so every
 * existing image keeps working untouched.
 */
const LADDER = [640, 1280, 2560]; // keep in sync with IMAGE_LADDER in imageUpload.ts

export interface ImgAttrs {
  src: string;
  srcSet?: string;
  sizes?: string;
}

/**
 * @param url    the stored image URL (may be null/undefined → returns empty src)
 * @param sizes  a CSS `sizes` hint for how wide the image renders (e.g.
 *               "(min-width:1024px) 33vw, 100vw"); omit for full-bleed use.
 */
export function imgAttrs(url: string | null | undefined, sizes?: string): ImgAttrs {
  if (!url) return { src: url ?? "" };
  const m = url.match(/_w(\d+)\.(webp|jpe?g|png)(\?.*)?$/i);
  if (!m) return { src: url };
  const maxW = Number(m[1]);
  const widths = [...LADDER.filter((w) => w < maxW), maxW];
  if (widths.length <= 1) return { src: url, sizes };
  const srcSet = widths.map((w) => `${url.replace(/_w\d+\./, `_w${w}.`)} ${w}w`).join(", ");
  return { src: url, srcSet, sizes };
}
