/**
 * revamp.community home (2026-10-29): hero + next meetup, what you'll find,
 * news & updates, guides, meetups, Revamp tools, member standards, FAQ, join.
 * Live data: published news, public guides, upcoming meetups, Telegram link —
 * every section has a calm empty state, so the page works on day one.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, BookOpen, CalendarDays, CreditCard, Home as HomeIcon, MessageCircle, Newspaper, RefreshCw, Smartphone, Sparkles, UserPlus, type LucideIcon } from "lucide-react";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { getCommunityTelegramUrl, joinCommunity, listPublicGuides, listPublishedNews, listUpcomingMeetups } from "@/lib/community";
import { userMessage } from "@/lib/api";
import { RE_PATH, RE_VIEWBOX } from "@shared/brandLogo";
import {
  COMMUNITY_FAQ,
  COMMUNITY_OFFERS,
  COMMUNITY_REVAMP_TOOLS,
  COMMUNITY_STANDARDS,
  HOSTS_OPTIONS,
  VACATIONS_ORIGIN,
  formatMeetupWhen,
  meetupPlace,
  type CommunityGuide,
  type CommunityMeetup,
  type CommunityNewsItem,
  type NewsCategory,
} from "@shared/community";
import { communityNoindex, useGoToSection } from "./communityNav";
import { useCommunityLang } from "./communityLang";
import { LeadNewsCard, NewsFilter, NewsRow } from "./CommunityNews";
import { GuideCard } from "./CommunityGuides";

const OFFER_ICONS: Record<string, LucideIcon> = { news: Newspaper, guides: BookOpen, meetups: CalendarDays, refer: UserPlus };
const TOOL_ICONS: LucideIcon[] = [Sparkles, Smartphone, CreditCard, RefreshCw, HomeIcon];

const h2 = "font-display text-[2rem] font-extrabold leading-tight tracking-tight sm:text-[2.75rem]";
const lede = "text-lg leading-relaxed text-basalt/75";

export default function CommunityHome() {
  const { lang, t, path } = useCommunityLang();
  const goTo = useGoToSection();
  const [news, setNews] = useState<CommunityNewsItem[] | null>(null);
  const [newsCat, setNewsCat] = useState<NewsCategory | null>(null);
  const [guides, setGuides] = useState<CommunityGuide[]>([]);
  const [meetups, setMeetups] = useState<CommunityMeetup[] | null>(null);
  const [telegramUrl, setTelegramUrl] = useState<string | null>(null);
  const [seatFor, setSeatFor] = useState<string>("");

  useDocumentMeta({
    title: t("meta.title"),
    description: t("meta.description"),
    canonicalPath: path("/"),
    noindex: communityNoindex(),
    jsonLd: { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: COMMUNITY_FAQ.map((_, i) => ({ "@type": "Question", name: t(`faq.${i}.q`), acceptedAnswer: { "@type": "Answer", text: t(`faq.${i}.a`) } })) },
  });

  useEffect(() => {
    listPublicGuides(3, lang).then(setGuides).catch((e) => console.error("[community] guides", e));
    listUpcomingMeetups(4, lang)
      .then(setMeetups)
      .catch((e) => {
        console.error("[community] meetups", e);
        setMeetups([]);
      });
    getCommunityTelegramUrl().then(setTelegramUrl).catch(() => setTelegramUrl(null));
  }, [lang]);

  useEffect(() => {
    let live = true;
    setNews(null);
    listPublishedNews({ category: newsCat, limit: 5, lang })
      .then((r) => live && setNews(r))
      .catch((e) => {
        console.error("[community] news", e);
        if (live) setNews([]);
      });
    return () => {
      live = false;
    };
  }, [newsCat, lang]);

  const next = meetups?.[0] ?? null;
  const saveSeat = (id: string) => {
    setSeatFor(id);
    goTo("join");
  };

  return (
    <>
      {/* Hero */}
      <section className="mx-auto flex max-w-[1240px] flex-col gap-10 px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-16 lg:flex-row lg:items-stretch">
        <div className="flex flex-1 flex-col justify-center gap-6">
          <p className="flex items-center gap-2.5 text-[15px] font-bold text-basalt/70">
            <span className="h-2.5 w-2.5 rounded-full bg-apricot" aria-hidden="true" />
            {t("hero.eyebrow")}
          </p>
          <h1 className={lang === "hy" ? "font-display text-[2.15rem] font-extrabold leading-[1.1] sm:text-[3.5rem]" : "font-display text-[2.9rem] font-extrabold leading-[1.02] tracking-[-0.03em] sm:text-[4.75rem]"}>{t("hero.title")}</h1>
          <p className="max-w-xl text-lg leading-relaxed text-basalt/80 sm:text-xl">
            {t("hero.body")}
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => goTo("join")} className="inline-flex h-[52px] items-center rounded-full bg-basalt px-7 text-[17px] font-bold text-paper hover:bg-basalt/90">
              {t("cta.join")}
            </button>
            <Link href="/news" className="inline-flex h-[52px] items-center rounded-full border-[1.5px] border-basalt px-7 text-[17px] font-bold">
              {t("cta.readNews")}
            </Link>
          </div>
        </div>
        <div className="relative flex min-h-[320px] flex-1 items-end overflow-hidden rounded-[32px] bg-apricot p-5 sm:min-h-[420px] sm:p-7">
          <svg viewBox={RE_VIEWBOX} className="pointer-events-none absolute -right-16 -top-4 w-[560px] max-w-none opacity-[0.16] sm:w-[640px]" aria-hidden="true">
            <path fill="#FFFFFF" d={RE_PATH} />
          </svg>
          <div className="relative flex w-full max-w-[400px] flex-col gap-3 rounded-[24px] bg-paper p-6">
            <p className="text-[13px] font-bold uppercase tracking-[0.06em] text-basalt/70">{t("meetup.next")}</p>
            {next ? (
              <>
                <p className="text-2xl font-extrabold leading-tight">{next.title}</p>
                <p className="text-base text-basalt/80">
                  {formatMeetupWhen(next.startsAt, lang).day}, {formatMeetupWhen(next.startsAt, lang).time}
                  <br />
                  {meetupPlace(next, lang)}
                </p>
                <button type="button" onClick={() => saveSeat(next.id)} className="mt-1 inline-flex h-11 items-center self-start rounded-full bg-apricot hover:bg-apricot/90 px-5 text-[15px] font-bold text-white">
                  {t("meetup.saveSeat")}
                </button>
              </>
            ) : (
              <>
                <p className="text-2xl font-extrabold leading-tight">{t("meetup.soonTitle")}</p>
                <p className="text-base text-basalt/80">{t("meetup.soonBody")}</p>
                <button type="button" onClick={() => goTo("join")} className="mt-1 inline-flex h-11 items-center self-start rounded-full bg-apricot hover:bg-apricot/90 px-5 text-[15px] font-bold text-white">
                  {t("meetup.tellMe")}
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* What you'll find */}
      <section className="bg-apricot-soft">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-10 px-4 py-16 sm:px-6 sm:py-20">
          <div className="flex max-w-2xl flex-col gap-3">
            <h2 className={h2}>{t("find.title")}</h2>
            <p className={lede}>{t("find.lede")}</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {COMMUNITY_OFFERS.map((o) => {
              const Icon = OFFER_ICONS[o.key] ?? Newspaper;
              const cta = o.href.startsWith("http") ? (
                <a href={o.href} className="mt-auto inline-flex min-h-11 items-center gap-1.5 text-[15px] font-bold hover:text-apricot">{t(`offer.${o.key}.cta`)} <ArrowRight className="h-4 w-4" /></a>
              ) : o.href.startsWith("/#") ? (
                <button type="button" onClick={() => goTo(o.href.slice(2))} className="mt-auto inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-bold hover:text-apricot">{t(`offer.${o.key}.cta`)} <ArrowRight className="h-4 w-4" /></button>
              ) : (
                <Link href={o.href} className="mt-auto inline-flex min-h-11 items-center gap-1.5 text-[15px] font-bold hover:text-apricot">{t(`offer.${o.key}.cta`)} <ArrowRight className="h-4 w-4" /></Link>
              );
              return (
                <div key={o.key} id={o.key === "refer" ? "refer" : undefined} className="flex scroll-mt-20 flex-col gap-3 rounded-[24px] bg-paper p-6 sm:p-7">
                  <Icon className="h-8 w-8 text-apricot" strokeWidth={1.8} aria-hidden="true" />
                  <h3 className="text-[1.35rem] font-extrabold">{t(`offer.${o.key}.title`)}</h3>
                  <p className="text-base leading-relaxed text-basalt/75">{t(`offer.${o.key}.body`)}</p>
                  {cta}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* News */}
      <section id="news" className="mx-auto flex max-w-[1240px] scroll-mt-20 flex-col gap-8 px-4 pt-16 sm:px-6 sm:pt-20">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex max-w-2xl flex-col gap-3">
            <h2 className={h2}>{t("news.title")}</h2>
            <p className={lede}>{t("news.homeLede")}</p>
          </div>
          <NewsFilter value={newsCat} onChange={setNewsCat} />
        </div>
        {news === null ? (
          <div className="grid gap-6 lg:grid-cols-2" aria-busy="true">
            <div className="h-80 animate-pulse rounded-[28px] bg-basalt/[0.06]" />
            <div className="h-80 animate-pulse rounded-[28px] bg-basalt/[0.04]" />
          </div>
        ) : news.length === 0 ? (
          <p className="rounded-[24px] bg-apricot-soft p-6 text-base">{t("news.emptyHome")}</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <LeadNewsCard item={news[0]} />
            <div className="flex flex-col">
              {news.slice(1).map((n) => <NewsRow key={n.id} item={n} />)}
              <Link href="/news" className="mt-5 inline-flex h-11 items-center self-start rounded-full border-[1.5px] border-basalt px-5 text-[15px] font-bold">{t("news.all")}</Link>
            </div>
          </div>
        )}
      </section>

      {/* Guides */}
      {guides.length > 0 && (
        <section id="guides" className="mx-auto flex max-w-[1240px] scroll-mt-20 flex-col gap-8 px-4 pt-16 sm:px-6 sm:pt-20">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex max-w-2xl flex-col gap-3">
              <h2 className={h2}>{t("guides.homeTitle")}</h2>
              <p className={lede}>{t("guides.homeLede")}</p>
            </div>
            <Link href="/guides" className="inline-flex h-11 items-center self-start rounded-full border-[1.5px] border-basalt px-5 text-[15px] font-bold">{t("guides.all")}</Link>
          </div>
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {guides.map((g) => <GuideCard key={g.slug} guide={g} />)}
          </div>
        </section>
      )}

      {/* Meetups */}
      <section id="meetups" className="mt-16 scroll-mt-20 bg-basalt text-paper sm:mt-20">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:flex-row">
          <div className="flex flex-col gap-4 lg:w-[38%]">
            <h2 className={h2}>{t("meetups.title")}</h2>
            <p className="text-lg leading-relaxed text-paper/75">{t("meetups.lede")}</p>
          </div>
          <div className="flex flex-1 flex-col">
            {meetups && meetups.length > 0 ? (
              meetups.map((m, i) => {
                const w = formatMeetupWhen(m.startsAt, lang);
                return (
                  <div key={m.id} className={`flex flex-col gap-3 border-t border-white/15 py-6 sm:flex-row sm:items-center sm:gap-7 ${i === meetups.length - 1 ? "border-b" : ""}`}>
                    <div className="text-base font-bold text-apricot sm:w-36">{w.day}<span className="block text-paper/70">{w.time}</span></div>
                    <div className="flex flex-1 flex-col gap-1">
                      <span className="text-xl font-extrabold">{m.title}</span>
                      <span className="text-[15px] text-paper/70">{meetupPlace(m, lang)}</span>
                      {m.description && <span className="text-[15px] leading-relaxed text-paper/70">{m.description}</span>}
                    </div>
                    <button type="button" onClick={() => saveSeat(m.id)} className="inline-flex h-11 items-center self-start rounded-full border-[1.5px] border-paper px-5 text-[15px] font-bold hover:bg-paper hover:text-basalt sm:self-center">
                      {t("meetup.saveSeat")}
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="rounded-[24px] bg-white/[0.07] p-6">
                <p className="text-xl font-extrabold">{t("meetups.emptyTitle")}</p>
                <p className="mt-2 text-[15px] text-paper/75">{t("meetups.emptyBody")}</p>
                <button type="button" onClick={() => goTo("join")} className="mt-4 inline-flex h-11 items-center rounded-full bg-apricot hover:bg-apricot/90 px-5 text-[15px] font-bold text-white">{t("cta.join")}</button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Revamp tools */}
      <section className="mx-auto flex max-w-[1240px] flex-col gap-8 px-4 py-16 sm:px-6 sm:py-20">
        <div className="flex max-w-2xl flex-col gap-3">
          <h2 className={h2}>{t("tools.title")}</h2>
          <p className={lede}>{t("tools.lede")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {COMMUNITY_REVAMP_TOOLS.map((tool, i) => {
            const Icon = TOOL_ICONS[i] ?? Sparkles;
            return (
              <div key={tool.title} className="flex items-start gap-4 rounded-[20px] border border-basalt/10 p-5">
                <Icon className="mt-0.5 h-6 w-6 shrink-0 text-apricot" strokeWidth={1.8} aria-hidden="true" />
                <div>
                  <p className="text-[17px] font-extrabold">{t(`tool.${i}.title`)}</p>
                  <p className="mt-1 text-[15px] leading-relaxed text-basalt/70">{t(`tool.${i}.body`)}</p>
                </div>
              </div>
            );
          })}
          <a href={`${VACATIONS_ORIGIN}/host`} className="flex items-center justify-between gap-3 rounded-[20px] bg-apricot-soft p-5 text-[17px] font-extrabold hover:bg-apricot/15">
            {t("tools.cta")} <ArrowRight className="h-5 w-5" />
          </a>
        </div>
      </section>

      {/* Standards */}
      <section className="bg-apricot-soft">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:flex-row">
          <div className="flex flex-col gap-3 lg:w-[38%]">
            <h2 className={h2}>{t("standards.title")}</h2>
            <p className={lede}>{t("standards.lede")}</p>
          </div>
          <ol className="grid flex-1 gap-4 sm:grid-cols-2">
            {COMMUNITY_STANDARDS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-2 rounded-[20px] bg-paper p-6">
                <span className="text-[1.75rem] font-extrabold text-apricot" aria-hidden="true">{i + 1}</span>
                <span className="text-lg font-extrabold">{t(`standard.${i}.title`)}</span>
                <span className="text-[15px] leading-relaxed text-basalt/70">{t(`standard.${i}.body`)}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto flex max-w-[880px] flex-col gap-6 px-4 py-16 sm:px-6 sm:py-20">
        <h2 className={h2}>{t("faq.title")}</h2>
        <div>
          {COMMUNITY_FAQ.map((f, i) => (
            <details key={f.q} className={`group border-t border-basalt/10 py-5 ${i === COMMUNITY_FAQ.length - 1 ? "border-b" : ""}`} open={i === 0}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-lg font-extrabold">
                {t(`faq.${i}.q`)}
                <span className="text-2xl font-normal text-apricot transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="mt-2 text-[17px] leading-relaxed text-basalt/80">{t(`faq.${i}.a`)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Join */}
      <section id="join" className="scroll-mt-20 px-4 pb-16 sm:px-6 sm:pb-20">
        <JoinBand meetups={meetups ?? []} seatFor={seatFor} onSeatFor={setSeatFor} telegramUrl={telegramUrl} />
      </section>
    </>
  );
}

function JoinBand({ meetups, seatFor, onSeatFor, telegramUrl }: { meetups: CommunityMeetup[]; seatFor: string; onSeatFor: (id: string) => void; telegramUrl: string | null }) {
  const { lang, t } = useCommunityLang();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [hosts, setHosts] = useState<string>("stays");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { seat: boolean }>(null);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // "Save my seat" lands here — put the cursor in the email field.
  useEffect(() => {
    if (seatFor) window.setTimeout(() => emailRef.current?.focus({ preventScroll: true }), 400);
  }, [seatFor]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await joinCommunity({ email: email.trim(), name: name.trim() || undefined, hosts, meetupId: seatFor || undefined });
      setDone({ seat: r.seat });
    } catch (err) {
      setError(lang === "hy" ? t("join.failed") : userMessage(err, t("join.failed")));
    } finally {
      setBusy(false);
    }
  };

  const field = "h-12 w-full rounded-[14px] border-0 bg-paper px-4 text-base text-basalt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot";
  const label = "flex flex-col gap-2 text-[15px] font-bold";

  return (
    <div className="relative mx-auto flex max-w-[1240px] flex-col gap-10 overflow-hidden rounded-[32px] bg-basalt px-5 py-10 text-paper sm:px-12 sm:py-16 lg:flex-row lg:items-center">
      <div className="flex flex-1 flex-col gap-4">
        <p className="flex flex-col font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-tight sm:text-[3.5rem]">
          <span>Stay.</span>
          <span className="text-apricot">Experience.</span>
          <span>Repeat.</span>
        </p>
        <p className="max-w-md text-lg leading-relaxed text-paper/75">{t("join.body")}</p>
        {telegramUrl && (
          <a href={telegramUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center gap-2 self-start rounded-full border-[1.5px] border-paper px-5 text-base font-bold hover:bg-paper hover:text-basalt">
            <MessageCircle className="h-5 w-5" aria-hidden="true" /> {t("join.telegram")}
          </a>
        )}
      </div>
      {done ? (
        <div className="flex flex-1 flex-col gap-3 rounded-[24px] bg-white/[0.07] p-6" role="status">
          <p className="text-2xl font-extrabold">{t(done.seat ? "join.doneSeat" : "join.doneIn")}</p>
          <p className="text-base leading-relaxed text-paper/80">{t("join.doneBody", { email: email.trim() })}</p>
          <Link href="/news" className="mt-2 inline-flex h-11 items-center self-start rounded-full bg-apricot hover:bg-apricot/90 px-5 text-[15px] font-bold text-white">{t("join.readNews")}</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-1 flex-col gap-4" noValidate={false}>
          <label className={label}>
            {t("join.email")}
            <input ref={emailRef} type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={field} />
          </label>
          <label className={label}>
            <span>{t("join.name")} <span className="text-sm font-normal text-paper/70">{t("join.optional")}</span></span>
            <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={field} maxLength={120} />
          </label>
          <label className={label}>
            {t("join.hosts")}
            <select value={hosts} onChange={(e) => setHosts(e.target.value)} className={field}>
              {HOSTS_OPTIONS.map((o) => <option key={o.key} value={o.key}>{t(`hosts.${o.key}`)}</option>)}
            </select>
          </label>
          {meetups.length > 0 && (
            <label className={label}>
              {t("join.seat")}
              <select value={seatFor} onChange={(e) => onSeatFor(e.target.value)} className={field}>
                <option value="">{t("join.notNow")}</option>
                {meetups.map((m) => {
                  const w = formatMeetupWhen(m.startsAt, lang);
                  return <option key={m.id} value={m.id}>{w.day} · {m.title}</option>;
                })}
              </select>
            </label>
          )}
          {error && <p className="rounded-xl bg-white/10 px-4 py-3 text-[15px]" role="alert">{error}</p>}
          <p className="text-sm leading-relaxed text-paper/70">
            {t("join.privacy")}{" "}
            <a href={`${VACATIONS_ORIGIN}/privacy#community`} className="font-semibold text-paper underline underline-offset-2">{t("footer.privacy")}</a>
          </p>
          <button type="submit" disabled={busy} aria-busy={busy} className="mt-1 inline-flex h-[52px] items-center justify-center rounded-full bg-apricot hover:bg-apricot/90 px-7 text-[17px] font-bold text-white disabled:cursor-wait sm:self-start">
            {t(busy ? "join.busy" : seatFor ? "join.submitSeat" : "cta.join")}
          </button>
        </form>
      )}
    </div>
  );
}
