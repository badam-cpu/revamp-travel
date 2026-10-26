/**
 * /ai — Revamp inside ChatGPT and Claude, for travellers (the technical connect
 * page is /developers). Copy lives in shared/aiPage.ts, shared with the crawler
 * HTML in server/prerender.ts.
 *
 * The chat illustration uses real published stays (their own photos and "from"
 * nightly price) and is labelled as an illustration: it never claims
 * availability or a total — in the chat those come live from the connector.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CalendarCheck, Check, Copy, ExternalLink, Images, Receipt, ShieldCheck, Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ReMark, Wordmark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useListings, type LiveListing } from "@/contexts/ListingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { nightlyPriceRange } from "@shared/bookings";
import { isDiscoverable } from "@shared/listings";
import { AI_APPS, AI_BENEFITS, AI_PAGE, AI_PAGE_PATH, AI_PROMPTS, type AiApp } from "@shared/aiPage";
import { cn } from "@/lib/utils";

const BENEFIT_ICONS = { availability: CalendarCheck, price: Receipt, photos: Images, book: ShieldCheck } as const;

function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("h-10 shrink-0 gap-1.5 rounded-none", className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch (err) {
          console.error("[ai] copy failed", err);
        }
      }}
      aria-label={`${label}: ${text}`}
    >
      {done ? <Check className="h-4 w-4 text-apricot" /> : <Copy className="h-4 w-4" />}
      {done ? "Copied" : label}
    </Button>
  );
}

/** Up to three published stays with an uploaded photo — real examples for the illustration. */
function useExampleStays(): LiveListing[] {
  const { listings } = useListings();
  return useMemo(
    () =>
      listings
        .filter((l) => l.type === "stay" && isDiscoverable(l) && /^https:\/\//.test(l.image) && l.price > 0)
        .sort((a, b) => Number(b.featured) - Number(a.featured))
        .slice(0, 3),
    [listings],
  );
}

function ChatIllustration() {
  const stays = useExampleStays();
  const { format } = useCurrency();
  return (
    <figure className="min-w-0">
      <div className="rounded-none border border-basalt/10 bg-paper p-4 shadow-[0_24px_60px_-30px_rgba(33,33,33,0.35)] sm:p-5">
        <div className="ml-auto w-fit max-w-[85%] rounded-none bg-basalt px-4 py-2.5 text-sm text-white">{AI_PROMPTS[0]}</div>
        <div className="mt-4 flex items-center gap-2 text-xs text-basalt/60">
          <Wordmark className="h-3.5 text-apricot" />
          <span>Results from Revamp</span>
        </div>
        <div className="mt-2.5 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {(stays.length ? stays : [null, null, null]).map((l, i) => {
            const from = l ? nightlyPriceRange({ priceCents: Math.round(l.price * 100), priceUnit: l.priceUnit, seasonalRates: l.seasonalRates }).lowCents : 0;
            return (
              <div key={l?.id ?? i} className="w-44 shrink-0 overflow-hidden rounded-none border border-basalt/10 bg-paper sm:w-48">
                <div className="relative aspect-[4/3] bg-chalk">
                  {l && <img src={l.image} alt={l.title} loading="lazy" className="h-full w-full object-cover" />}
                  <span className="absolute left-2 top-2 rounded-full bg-paper px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.18em] text-apricot">Stay</span>
                </div>
                <div className="p-2.5">
                  <p className="line-clamp-2 min-h-[2.5em] text-[13px] font-bold leading-tight text-basalt">{l?.title ?? " "}</p>
                  <p className="mt-0.5 truncate text-[11px] text-basalt/55">{l?.city ?? " "}</p>
                  <p className="mt-1.5 text-[13px] font-extrabold text-basalt">{l ? <>from {format(from)} <span className="font-medium text-basalt/55">/ night</span></> : " "}</p>
                  <p className="mt-1.5 text-[11px] font-bold text-apricot">View on Revamp ↗</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <figcaption className="mt-3 text-xs leading-5 text-basalt/55">
        Illustration with real Revamp stays. In the chat, each card shows whether it's available and the total for your dates.
      </figcaption>
    </figure>
  );
}

function AppCard({ app }: { app: AiApp }) {
  return (
    <div className="flex min-w-0 flex-col rounded-none border border-basalt/10 bg-paper p-5 sm:p-6">
      <h3 className="font-display text-xl tracking-tight text-basalt">{app.name}</h3>
      {app.listingUrl ? (
        <>
          <p className="mt-2 text-sm leading-6 text-basalt/65">Add Revamp Vacations from the {app.name} app directory, then ask away.</p>
          <Button asChild className="mt-5 h-11 w-full rounded-full bg-apricot text-white hover:bg-apricot/90 sm:w-fit">
            <a href={app.listingUrl} target="_blank" rel="noopener noreferrer">
              Add to {app.name} <ExternalLink className="ml-1.5 h-4 w-4" />
            </a>
          </Button>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm leading-6 text-basalt/65">{app.pending}</p>
          <ol className="mt-4 grid gap-2.5 text-sm leading-6 text-basalt/80">
            {app.steps.map((s, i) => (
              <li key={s} className="flex gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-apricot/10 text-[11px] font-bold text-apricot">{i + 1}</span>
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex min-w-0 flex-wrap items-center gap-2 rounded-none border border-basalt/12 bg-chalk p-2 pl-3">
            <code className="min-w-0 flex-1 break-all text-[13px] text-basalt">{app.connectorUrl}</code>
            <CopyButton text={app.connectorUrl} label="Copy address" />
          </div>
        </>
      )}
    </div>
  );
}

export default function AiAssistants() {
  useDocumentMeta({
    title: AI_PAGE.metaTitle,
    description: AI_PAGE.description,
    canonicalPath: AI_PAGE_PATH,
  });

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-basalt/10 bg-chalk">
          <ReMark className="pointer-events-none absolute -bottom-10 -right-16 h-auto w-[34rem] max-w-none text-apricot/[0.07]" />
          <div className="container relative grid gap-10 py-12 sm:py-16 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-14">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-apricot">
                <Sparkles className="h-3.5 w-3.5" /> AI assistants
              </div>
              <h1 className="mt-3 max-w-xl font-display text-4xl leading-[1.02] tracking-[-0.03em] sm:text-5xl">{AI_PAGE.title}</h1>
              <p className="mt-4 max-w-lg text-base leading-7 text-basalt/65">{AI_PAGE.intro}</p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-12 rounded-full bg-apricot px-6 text-base text-white hover:bg-apricot/90 sm:h-11 sm:text-sm">
                  <a href="#add">
                    Add it to your assistant <ArrowRight className="ml-1.5 h-4 w-4" />
                  </a>
                </Button>
                <Button asChild variant="outline" className="h-12 rounded-full px-6 text-base sm:h-11 sm:text-sm">
                  <a href="#try">See what to ask</a>
                </Button>
              </div>
            </div>
            <ChatIllustration />
          </div>
        </section>

        {/* Benefits */}
        <section className="container py-12 sm:py-16">
          <h2 className="font-display text-2xl tracking-tight sm:text-3xl">What you get in the chat</h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
            {AI_BENEFITS.map((b) => {
              const Icon = BENEFIT_ICONS[b.key];
              return (
                <div key={b.key} className="rounded-none border border-basalt/10 bg-paper p-5">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-none bg-apricot/10 text-apricot">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-semibold text-basalt">{b.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-basalt/65">{b.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Prompts */}
        <section id="try" className="scroll-mt-20 border-y border-basalt/10 bg-chalk">
          <div className="container py-12 sm:py-16">
            <h2 className="font-display text-2xl tracking-tight sm:text-3xl">Try asking</h2>
            <p className="mt-2 max-w-xl text-basalt/65">Say where, when and how many of you. Revamp does the checking.</p>
            <ul className="mt-7 grid gap-3 lg:grid-cols-2">
              {AI_PROMPTS.map((p) => (
                <li key={p} className="flex min-w-0 items-center gap-3 rounded-none border border-basalt/10 bg-paper p-3 pl-4">
                  <span className="min-w-0 flex-1 text-[15px] leading-6 text-basalt">“{p}”</span>
                  <CopyButton text={p} />
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Add it */}
        <section id="add" className="container scroll-mt-20 py-12 sm:py-16">
          <h2 className="font-display text-2xl tracking-tight sm:text-3xl">Add Revamp to your assistant</h2>
          <p className="mt-2 max-w-xl text-basalt/65">Free to use, no Revamp account needed to search. You sign in only when you book.</p>
          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            {AI_APPS.map((a) => (
              <AppCard key={a.key} app={a} />
            ))}
          </div>
          <p className="mt-8 max-w-2xl text-sm leading-6 text-basalt/60">
            The assistant only sends Revamp what it needs to search — like the place, dates and number of guests — never your chat history. See{" "}
            <Link href="/privacy" className="font-medium text-basalt underline underline-offset-4">
              our privacy policy
            </Link>
            . Building something?{" "}
            <Link href="/developers" className="font-medium text-basalt underline underline-offset-4">
              Developer docs
            </Link>
            .
          </p>
          <p className="mt-3 text-sm text-basalt/60">
            Prefer to plan here?{" "}
            <Link href="/plan" className="font-medium text-apricot underline-offset-4 hover:underline">
              Try the Revamp AI trip planner →
            </Link>
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
