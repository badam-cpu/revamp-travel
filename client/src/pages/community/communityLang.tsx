/**
 * The language of revamp.community (migration 0131): English at /, Armenian at
 * /hy. Provides t() (shared/communityText.ts + the admin's Armenian edits) and
 * path() for canonical links. In-site links need nothing special: CommunityApp
 * wraps the site in a wouter Router with base "/hy".
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getTextEdits } from "@/lib/community";
import { communityText, type CommunityT } from "@shared/communityText";
import type { CommunityLang } from "@shared/community";

interface LangValue {
  lang: CommunityLang;
  t: CommunityT;
  /** The address of a page in this language: "/news" → "/hy/news". */
  path: (p: string) => string;
}

const LangContext = createContext<LangValue>({ lang: "en", t: communityText("en"), path: (p) => p });

export const langPath = (lang: CommunityLang, p: string) => (lang === "hy" ? `/hy${p === "/" ? "" : p}` : p);

export function CommunityLangProvider({ lang, children }: { lang: CommunityLang; children: ReactNode }) {
  const [edits, setEdits] = useState<Partial<Record<CommunityLang, Record<string, string>>>>({});
  useEffect(() => {
    if (edits[lang]) return;
    getTextEdits(lang)
      .then((v) => setEdits((p) => ({ ...p, [lang]: v })))
      .catch((e) => console.error("[community] site text", e));
  }, [lang, edits]);
  const value = useMemo<LangValue>(() => ({ lang, t: communityText(lang, edits[lang]), path: (p) => langPath(lang, p) }), [lang, edits]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useCommunityLang = () => useContext(LangContext);
