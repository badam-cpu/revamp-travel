/**
 * Dashboard → Integrations, grouped into category blocks (Payments, Pricing,
 * Reviews) with a category bar to show one group or all. Deep-linkable via
 * `?section=integrations&cat=<key>`. The cards themselves are unchanged.
 */
import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { LayoutGrid, Star, TrendingUp, Wallet } from "lucide-react";
import { PayLinkConnect } from "@/components/PayLinkConnect";
import { PriceLabsSync } from "@/components/PriceLabsSync";
import { PriceLabsConnect } from "@/components/PriceLabsConnect";
import { ExternalReviewsManager } from "@/components/ExternalReviewsManager";
import { cn } from "@/lib/utils";

type GroupKey = "payments" | "pricing" | "reviews";

const GROUPS: { key: GroupKey; label: string; icon: typeof Wallet; blurb: string; cards: number; render: () => React.ReactNode }[] = [
  {
    key: "payments",
    label: "Payments",
    icon: Wallet,
    blurb: "Get paid directly into your own PayLink account.",
    cards: 1,
    render: () => <PayLinkConnect />,
  },
  {
    key: "pricing",
    label: "Pricing",
    icon: TrendingUp,
    blurb: "Dynamic pricing with PriceLabs — sync recommended nightly rates, or share your availability with it.",
    cards: 2,
    render: () => (
      <>
        <PriceLabsSync />
        <PriceLabsConnect />
      </>
    ),
  },
  {
    key: "reviews",
    label: "Reviews",
    icon: Star,
    blurb: "Show your Google and Airbnb reviews on your Revamp listings.",
    cards: 1,
    render: () => <ExternalReviewsManager />,
  },
];

export function OperatorIntegrations() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const fromUrl = new URLSearchParams(search).get("cat") as GroupKey | null;
  const [active, setActive] = useState<GroupKey | "all">(fromUrl && GROUPS.some((g) => g.key === fromUrl) ? fromUrl : "all");
  useEffect(() => {
    if (fromUrl && GROUPS.some((g) => g.key === fromUrl)) setActive(fromUrl);
  }, [fromUrl]);

  const pick = (key: GroupKey | "all") => {
    setActive(key);
    navigate(key === "all" ? "/dashboard?section=integrations" : `/dashboard?section=integrations&cat=${key}`, { replace: true });
  };

  const tabs: { key: GroupKey | "all"; label: string; icon: typeof Wallet; count: number }[] = [
    { key: "all", label: "All", icon: LayoutGrid, count: GROUPS.reduce((a, g) => a + g.cards, 0) },
    ...GROUPS.map((g) => ({ key: g.key, label: g.label, icon: g.icon, count: g.cards })),
  ];

  return (
    <div className="grid gap-10">
      <div role="tablist" aria-label="Integration categories" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => pick(t.key)}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot",
              active === t.key ? "border-basalt bg-basalt text-paper" : "border-basalt/15 bg-paper text-basalt/70 hover:border-basalt/40 hover:text-basalt",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
            <span className={cn("tabular-nums text-xs", active === t.key ? "text-paper/60" : "text-basalt/40")}>{t.count}</span>
          </button>
        ))}
      </div>

      {GROUPS.filter((g) => active === "all" || active === g.key).map((g) => (
        <section key={g.key} aria-labelledby={`int-${g.key}`} className="grid gap-5">
          <div className="flex items-start gap-3 border-b border-basalt/10 pb-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-basalt text-paper"><g.icon className="h-4 w-4" /></span>
            <div>
              <h2 id={`int-${g.key}`} className="font-display text-2xl leading-tight tracking-[-0.02em]">{g.label}</h2>
              <p className="mt-1 text-sm text-basalt/60">{g.blurb}</p>
            </div>
          </div>
          <div className="grid gap-6">{g.render()}</div>
        </section>
      ))}
    </div>
  );
}
