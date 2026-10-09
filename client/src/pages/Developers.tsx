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
import { Search, FileText, CalendarCheck, Map, Plug, Copy, Check, ArrowRight, Terminal } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";

const MCP_URL = "https://mcp.revampvacations.com/mcp";

const TOOLS = [
  { icon: Search, name: "search_listings", blurb: "Search stays, tours, experiences, restaurants and places to visit across Armenia — by type, region, cuisine or free text." },
  { icon: FileText, name: "get_listing", blurb: "Fetch full details for one listing by slug: description, amenities, highlights, branches and the booking link." },
  { icon: CalendarCheck, name: "check_availability", blurb: "Check whether a stay is free for a date range, with its busy ranges returned." },
  { icon: Map, name: "plan_trip", blurb: "Generate a day-by-day Armenia itinerary grounded in the real, published catalog." },
] as const;

const CLAUDE_STEPS = [
  "Open Settings → Connectors → Add custom connector.",
  `Paste the URL: ${MCP_URL}`,
  "Choose “No sign-in” and connect.",
  "Ask: “Use the Revamp connector to find stays in Dilijan.”",
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
    <div className="relative">
      <pre className="overflow-x-auto rounded-none border border-basalt/10 bg-basalt px-4 py-3.5 text-[13px] leading-relaxed text-paper/90">
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
      "A public, read-only Model Context Protocol (MCP) server exposing Revamp Vacations' live Armenia travel catalog — stays, tours, experiences, restaurants and places — to AI assistants. Tools: search_listings, get_listing, check_availability, plan_trip.",
    documentation: `${origin}/developers`,
    termsOfService: `${origin}/terms`,
    provider: { "@type": "Organization", name: "Revamp Vacations", url: origin },
    url: MCP_URL,
  };

  useDocumentMeta({
    title: "Developers — Revamp MCP for AI assistants",
    description:
      "Connect any MCP-capable AI assistant to Revamp's live Armenia travel catalog. Read-only, no auth. Tools: search_listings, get_listing, check_availability, plan_trip.",
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
              <div className="inline-flex items-center gap-3 rounded-none border border-basalt/15 bg-paper px-4 py-2.5">
                <code className="text-sm text-basalt">{MCP_URL}</code>
                <CopyButton text={MCP_URL} label="Copy URL" />
              </div>
            </div>
          </div>
        </section>

        {/* Tools */}
        <section className="mx-auto max-w-5xl px-5 py-14">
          <h2 className="font-display text-2xl tracking-tight text-basalt">Four tools</h2>
          <p className="mt-2 max-w-2xl text-basalt/65">Everything returns real, currently-published data with a link back to each listing.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
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

        {/* Connect */}
        <section className="border-t border-basalt/10 bg-chalk">
          <div className="mx-auto max-w-5xl px-5 py-14">
            <h2 className="font-display text-2xl tracking-tight text-basalt">Connect in a minute</h2>

            <div className="mt-8 grid gap-10 lg:grid-cols-2">
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
                Try the AI trip planner on the site <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
