/**
 * /admin → Analytics: two tabs, styled like the operator dashboard's Analytics
 * pills — Listing performance (AnalyticsDashboard, embedded) and AI assistants
 * (AiVisibility, migration 0114). The chosen tab is remembered per browser.
 */
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";
import { AiVisibility } from "@/components/AiVisibility";
import { cn } from "@/lib/utils";

type Tab = "listings" | "ai";
const TABS: { key: Tab; label: string; sub: string }[] = [
  { key: "listings", label: "Listing performance", sub: "How travellers find and book listings across the marketplace." },
  { key: "ai", label: "AI assistants", sub: "How ChatGPT, Claude, Perplexity and other AI assistants show Revamp to people." },
];
const TAB_KEY = "revamp.adminAnalyticsTab";

export function AdminAnalytics() {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const v = localStorage.getItem(TAB_KEY);
      return TABS.some((t) => t.key === v) ? (v as Tab) : "listings";
    } catch {
      return "listings";
    }
  });
  const choose = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* private mode — not remembered */
    }
  };
  return (
    <div>
      <PageHeader
        title="Analytics"
        sub={TABS.find((t) => t.key === tab)?.sub}
        actions={
          <div role="group" aria-label="Section" className="inline-flex max-w-full flex-wrap rounded-[1.25rem] border border-basalt/15 bg-paper p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tab === t.key}
                onClick={() => choose(t.key)}
                className={cn(
                  "h-9 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot",
                  tab === t.key ? "bg-basalt text-paper" : "text-basalt/70 hover:text-basalt",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />
      {tab === "listings" ? <AnalyticsDashboard scope="admin" embedded /> : <AiVisibility />}
    </div>
  );
}
