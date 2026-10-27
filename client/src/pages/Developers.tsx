/**
 * /developers — the public connect page for Revamp's MCP (Model Context
 * Protocol) server. This is the canonical destination we advertise so AI
 * assistants and their builders can wire up Revamp's LIVE Armenia catalog:
 * what the server is, the endpoint URL, copy-paste configs per client, the
 * four tools, and example prompts. Static content; emits WebAPI JSON-LD and is
 * listed in the sitemap + llms.txt. The MCP endpoint itself lives at
 * https://mcp.revampvacations.com/mcp (streaming, read-only, no auth).
 */
import { useState } from "react";
import { Link } from "wouter";
import { Search, FileText, CalendarCheck, Map, Plug, Copy, Check, ArrowRight, Terminal, Receipt } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";

const MCP_URL = "https://mcp.revampvacations.com/mcp";

const TOOLS = [
  { icon: Search, name: "search_listings", blurb: "Search stays, tours, experiences, restaurants and places to visit across Armenia — by type, region, cuisine or free text." },
  { icon: FileText, name: "get_listing", blurb: "Fetch full details for one listing by slug: description, amenities, highlights, facts, capacity and the page link." },
  { icon: Receipt, name: "get_quote", blurb: "Exact all-in price for real dates and party size — itemised fees and tax, cancellation terms, payment — plus open time slots for tours and experiences, and a link to book." },
  { icon: CalendarCheck, name: "check_availability", blurb: "Whether a stay is free for a date range, or which time slots a tour or experience has on a date." },
  { icon: Map, name: "plan_trip", blurb: "Generate a suggested day-by-day Armenia itinerary using the published catalog." },
] as const;

const CLAUDE_STEPS = [
  "Open Settings → Connectors → Add custom connector.",
  `Paste the URL: ${MCP_URL}`,
  "Choose “No sign-in” and connect.",
  "Ask: “Use the Revamp connector to find stays in Dilijan.”",
];

const REFERENCE = [
  {
    name: "search_listings",
    inputs: "type (stay · tour · experience · eat · place), region, query, cuisine, limit (1–50, default 10) — all optional.",
    returns: "count and results: slug, type, title, location, headline price in AMD, short description, tags, Google rating where shown (labelled), page URL.",
    errors: "None expected — no match returns an empty list.",
  },
  {
    name: "get_listing",
    inputs: "slug.",
    returns: "Everything from search plus long description, amenities, highlights, facts, maximum guests, branches, the listing's own photos with captions, and the host's answers to common guest questions (faq).",
    errors: "“No published listing with that slug.”",
  },
  {
    name: "get_quote",
    inputs: "slug, startDate (YYYY-MM-DD), endDate (stays: check-out), guests (default 2).",
    returns: "available (true / false / null with a reason), itemised price in AMD (accommodation or per-guest price, discount, fees, tax, total), time slots with seats left (tours, experiences), room types (hotels), cancellation terms, payment terms, booking mode, and a link to book (pre-filled checkout for stays).",
    errors: "Unknown slug, past date, check-out before check-in, restaurant or place (not bookable), or a temporary failure — each with a plain message.",
  },
  {
    name: "check_availability",
    inputs: "slug, startDate, endDate (stays), guests (default 2).",
    returns: "available (true / false / null with a reason), time slots or room types where relevant, and the booking link.",
    errors: "Same as get_quote.",
  },
  {
    name: "plan_trip",
    inputs: "days (1–14), startCity, travelers, pace (relaxed · balanced · packed), budget (budget · mid-range · comfort), interests.",
    returns: "A suggested day-by-day itinerary using published listings, with links. It doesn't check dates or book.",
    errors: "“The trip planner is unavailable right now.”",
  },
];

const CURSOR_CONFIG = `{
  "mcpServers": {
    "revamp": {
      "url": "${MCP_URL}"
    }
  }
}`;

const MCP_REMOTE_CONFIG = `{
  "mcpServers": {
    "revamp": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${MCP_URL}"]
    }
  }
}`;

const EXAMPLE_PROMPTS = [
  "Find highly-rated restaurants in Yerevan.",
  "Is the 1BR with Cascade views free next weekend?",
  "Plan a relaxed 3-day food-and-history trip from Yerevan.",
  "Show me guesthouses in Dilijan with a link to book.",
];

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — no-op */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-none border border-basalt/15 bg-paper px-3 py-1.5 text-xs font-medium text-basalt transition hover:border-basalt/30"
      aria-label={copied ? "Copied" : label}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-apricot" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative min-w-0 max-w-full">
      <pre className="max-w-full overflow-x-auto rounded-none border border-basalt/10 bg-basalt px-4 py-3.5 text-[13px] leading-relaxed text-paper/90">
        <code>{code}</code>
      </pre>
      <div className="absolute right-2.5 top-2.5">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

export default function Developers() {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://revampvacations.com";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebAPI",
    name: "Revamp Vacations MCP",
    description:
      "A public, read-only Model Context Protocol (MCP) server exposing Revamp Vacations' live Armenia travel catalog — stays, tours, experiences, restaurants and places — to AI assistants. Tools: search_listings, get_listing, get_quote, check_availability, plan_trip.",
    documentation: `${origin}/developers`,
    termsOfService: `${origin}/terms`,
    provider: { "@type": "Organization", name: "Revamp Vacations", url: origin },
    url: MCP_URL,
  };

  useDocumentMeta({
    title: "Developers — Revamp MCP for AI assistants",
    description:
      "Connect any MCP-capable AI assistant to Revamp's live Armenia travel catalog. Read-only, no auth. Tools: search_listings, get_listing, get_quote, check_availability, plan_trip.",
    canonicalPath: "/developers",
    jsonLd,
  });

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="border-b border-basalt/10 bg-chalk">
          <div className="mx-auto max-w-5xl px-5 py-16 sm:py-20">
            <div className="inline-flex items-center gap-2 rounded-none border border-basalt/15 bg-paper px-3 py-1 text-xs font-medium uppercase tracking-wide text-basalt/70">
              <Plug className="h-3.5 w-3.5 text-apricot" /> Model Context Protocol
            </div>
            <h1 className="mt-6 max-w-2xl font-display text-4xl leading-tight tracking-tight text-basalt sm:text-5xl">
              Bring Armenia's live travel catalog into your AI assistant.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-7 text-basalt/70">
              Revamp runs a public, read-only <span className="font-medium text-basalt">MCP server</span> so any MCP-capable
              assistant — Claude, Cursor, Cline and more — can search real stays, tours, experiences and restaurants across
              Armenia, check availability, and plan trips grounded in the live catalog. No sign-up, no API key.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="inline-flex max-w-full flex-wrap items-center gap-3 rounded-none border border-basalt/15 bg-paper px-4 py-2.5">
                <code className="min-w-0 break-all text-sm text-basalt">{MCP_URL}</code>
                <CopyButton text={MCP_URL} label="Copy URL" />
              </div>
            </div>
          </div>
        </section>

        {/* Tools */}
        <section className="mx-auto max-w-5xl px-5 py-14">
          <h2 className="font-display text-2xl tracking-tight text-basalt">Five tools</h2>
          <p className="mt-2 max-w-2xl text-basalt/65">All read-only: they return currently published data — prices, dates and time slots included — with a link back to each listing. Nothing is held or booked.</p>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
            {TOOLS.map((t) => (
              <div key={t.name} className="rounded-none border border-basalt/10 bg-paper p-5">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-none bg-chalk text-apricot">
                    <t.icon className="h-4.5 w-4.5" />
                  </span>
                  <code className="text-sm font-medium text-basalt">{t.name}</code>
                </div>
                <p className="mt-3 text-sm leading-6 text-basalt/70">{t.blurb}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Reference — what each tool takes and returns, permissions, errors, limits, data (for connector reviews, e.g. Meta Muse). */}
        <section className="mx-auto max-w-5xl px-5 pb-14" id="reference">
          <h2 className="font-display text-2xl tracking-tight text-basalt">Reference</h2>
          <div className="mt-6 grid gap-3">
            {REFERENCE.map((t) => (
              <details key={t.name} className="group border border-basalt/10 bg-paper">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3">
                  <code className="text-sm font-medium text-basalt">{t.name}</code>
                  <span className="shrink-0 rounded-full bg-chalk px-2.5 py-0.5 text-xs font-semibold text-basalt/70">Read · no side effects</span>
                </summary>
                <dl className="grid gap-3 border-t border-basalt/10 px-5 py-4 text-sm leading-6 text-basalt/75 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <dt className="font-semibold text-basalt">Inputs</dt>
                  <dd>{t.inputs}</dd>
                  <dt className="font-semibold text-basalt">Returns</dt>
                  <dd>{t.returns}</dd>
                  <dt className="font-semibold text-basalt">Errors</dt>
                  <dd>{t.errors}</dd>
                </dl>
              </details>
            ))}
          </div>
          <dl className="mt-8 grid gap-4 text-sm leading-6 text-basalt/75 sm:grid-cols-2 [&>div]:min-w-0">
            <div><dt className="font-semibold text-basalt">Permissions</dt><dd>Every tool is a read (MCP <code>readOnlyHint: true</code>): no accounts, bookings, payments, messages or other changes. Booking and payment happen on revampvacations.com.</dd></div>
            <div><dt className="font-semibold text-basalt">Authentication</dt><dd>None — the catalog is public, so there's no account or test account to set up.</dd></div>
            <div><dt className="font-semibold text-basalt">Errors</dt><dd>Tool errors come back as a normal tool result with <code>isError: true</code> and a plain message (never internal details). Malformed requests get a JSON-RPC error.</dd></div>
            <div><dt className="font-semibold text-basalt">Rate limits</dt><dd>120 requests a minute per IP, and 10 <code>plan_trip</code> calls a minute per IP. Over the limit: HTTP 429 with <code>Retry-After: 60</code> and a JSON-RPC error.</dd></div>
            <div><dt className="font-semibold text-basalt">Data</dt><dd>Tools receive only what's in the request (search words, dates, party size, trip preferences) — no names, emails or payment details. We keep only counts of tool use (tool name and day), not request contents. <code>plan_trip</code> sends the trip preferences to Anthropic to write the itinerary. Nothing is sold or used to train models. See our <Link href="/privacy" className="text-apricot hover:underline">Privacy Policy</Link>.</dd></div>
            <div><dt className="font-semibold text-basalt">Prices</dt><dd>In Armenian dram (AMD). Quotes use the same rules as checkout — discounts, fees and 10% tax included — and show the cancellation terms. A booking is confirmed only after payment is verified on the site.</dd></div>
            <div><dt className="font-semibold text-basalt">Support and security</dt><dd><a href="mailto:hello@revampvacations.com" className="text-apricot hover:underline">hello@revampvacations.com</a> — Revamp Hospitality LLC, Yerevan, Armenia.</dd></div>
          </dl>
        </section>

        {/* Connect */}
        <section className="border-t border-basalt/10 bg-chalk">
          <div className="mx-auto max-w-5xl px-5 py-14">
            <h2 className="font-display text-2xl tracking-tight text-basalt">Connect in a minute</h2>

            <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-2 [&>*]:min-w-0">
              {/* Claude */}
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-basalt/70">Claude (web or desktop)</h3>
                <ol className="mt-4 space-y-3">
                  {CLAUDE_STEPS.map((s, i) => (
                    <li key={i} className="flex gap-3 text-sm leading-6 text-basalt/80">
                      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-basalt text-[11px] font-semibold text-paper">{i + 1}</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Cursor */}
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-basalt/70">Cursor</h3>
                <p className="mt-4 text-sm leading-6 text-basalt/70">Add to <code className="text-basalt">~/.cursor/mcp.json</code> (or your project's <code className="text-basalt">.cursor/mcp.json</code>):</p>
                <div className="mt-3"><CodeBlock code={CURSOR_CONFIG} /></div>
              </div>

              {/* mcp-remote */}
              <div className="lg:col-span-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-basalt/70">
                  <Terminal className="h-4 w-4" /> Cline, Claude Desktop config, or any stdio client
                </h3>
                <p className="mt-4 text-sm leading-6 text-basalt/70">Bridge the remote server to a local stdio client with <code className="text-basalt">mcp-remote</code> (needs Node):</p>
                <div className="mt-3"><CodeBlock code={MCP_REMOTE_CONFIG} /></div>
              </div>
            </div>
          </div>
        </section>

        {/* Example prompts */}
        <section className="mx-auto max-w-5xl px-5 py-14">
          <h2 className="font-display text-2xl tracking-tight text-basalt">Try asking</h2>
          <div className="mt-6 flex flex-wrap gap-3">
            {EXAMPLE_PROMPTS.map((p) => (
              <span key={p} className="rounded-none border border-basalt/15 bg-paper px-4 py-2 text-sm text-basalt/80">“{p}”</span>
            ))}
          </div>

          <div className="mt-12 rounded-none border border-basalt/10 bg-chalk p-6 text-sm leading-6 text-basalt/70">
            <p>
              <span className="font-medium text-basalt">Read-only and public.</span> The server exposes only the same
              published catalog the website already shows — no accounts, no secrets, no bookings or writes. Data is live
              and current. By connecting you agree to our <Link href="/terms" className="text-apricot hover:underline">Terms</Link>.
            </p>
            <p className="mt-3">
              Building something with it, or want a tool we don't have yet? Email{" "}
              <a href="mailto:hello@revampvacations.com" className="text-apricot hover:underline">hello@revampvacations.com</a>.
            </p>
          </div>

          <div className="mt-10">
            <Link href="/plan">
              <Button className="rounded-none bg-basalt text-paper hover:bg-basalt/90">
                Plan a trip with Aha on the site <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
