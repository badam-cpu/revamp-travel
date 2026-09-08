/**
 * Imperative per-page <head> updates — document.title, meta description,
 * meta robots, canonical link, Open Graph/Twitter tags, and one JSON-LD
 * script tag. No new dependency (plain DOM APIs) — this project avoids
 * adding a helmet-style library for something a small hook already
 * covers (see CLAUDE.md's Component Conventions).
 *
 * This is the *client-rendered* half of this app's SEO story: real
 * browsers and JS-executing crawlers (Googlebot) get correct per-page
 * metadata this way. Non-JS-executing crawlers never run this — they hit
 * server/prerender.ts's hand-written HTML instead, which duplicates the
 * same title/description/JSON-LD via shared/seo.ts so both paths agree.
 */
import { useEffect } from "react";

export interface DocumentMetaOptions {
  title: string;
  description: string;
  /** Root-relative, e.g. "/listing/forest-house-dilijan". */
  canonicalPath: string;
  /** Root-relative or absolute; defaults to the brand hero image if omitted. */
  ogImage?: string;
  jsonLd?: object | object[];
  noindex?: boolean;
}

function upsertMeta(attr: "name" | "property", key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function useDocumentMeta(opts: DocumentMetaOptions): void {
  const jsonLdString = opts.jsonLd ? JSON.stringify(opts.jsonLd) : undefined;

  useEffect(() => {
    document.title = opts.title;

    upsertMeta("name", "description", opts.description);
    upsertMeta("name", "robots", opts.noindex ? "noindex, nofollow" : "index, follow");
    upsertCanonical(`${window.location.origin}${opts.canonicalPath}`);

    const image = opts.ogImage ? (opts.ogImage.startsWith("http") ? opts.ogImage : `${window.location.origin}${opts.ogImage}`) : `${window.location.origin}/brand/revamp-mark.svg`;
    upsertMeta("property", "og:title", opts.title);
    upsertMeta("property", "og:description", opts.description);
    upsertMeta("property", "og:type", "website");
    upsertMeta("property", "og:url", `${window.location.origin}${opts.canonicalPath}`);
    upsertMeta("property", "og:image", image);
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", opts.title);
    upsertMeta("name", "twitter:description", opts.description);
    upsertMeta("name", "twitter:image", image);

    const scriptId = "revamp-jsonld";
    const existing = document.getElementById(scriptId);
    if (jsonLdString) {
      const script = existing instanceof HTMLScriptElement ? existing : document.createElement("script");
      script.id = scriptId;
      script.type = "application/ld+json";
      script.textContent = jsonLdString;
      if (!existing) document.head.appendChild(script);
    } else if (existing) {
      existing.remove();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.title, opts.description, opts.canonicalPath, opts.ogImage, opts.noindex, jsonLdString]);
}
