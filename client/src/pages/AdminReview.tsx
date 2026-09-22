/**
 * Admin console (/admin) — a sectioned back-office mirroring the operator
 * dashboard's sidebar layout (see Dashboard.tsx). Sections are driven by
 * ?section= so each is deep-linkable:
 *   Overview     — at-a-glance counts + shortcuts
 *   Reviews      — approve / send back pending operator listings
 *   Support      — the support inbox (AdminSupportInbox)
 *   Payouts      — operator payouts (AdminPayouts)
 *   Blog         — author & publish blog posts (AdminBlog)
 *   Site content — home CMS, add-ons, announcement, USD rate (AdminSiteContent)
 *
 * The review workflow itself is unchanged (see 0002_review_gate_and_admin.sql
 * for the schema/RLS/trigger, and Dashboard.tsx for the operator side).
 * Wrapped in RequireRole role="admin" — there's no self-serve admin signup;
 * that migration's header documents the one-line SQL to promote an account.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { AlertTriangle, Check, ExternalLink, Home, LayoutDashboard, ListChecks, MapPin, MessageSquare, MessagesSquare, Newspaper, Package, Palette, Users, Wallet, X } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { AdminSiteContent } from "@/components/AdminSiteContent";
import { AdminSupportInbox } from "@/components/AdminSupportInbox";
import { AdminPayouts } from "@/components/AdminPayouts";
import { AdminBlog } from "@/components/AdminBlog";
import { Inbox } from "@/components/Inbox";
import { AdminListings } from "@/components/AdminListings";
import { AdminAccounts } from "@/components/AdminAccounts";
import { useAuth } from "@/contexts/AuthContext";
import { RequireRole } from "@/components/RequireRole";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { typeLabels, ListingType } from "@shared/listings";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PendingListing {
  id: string;
  slug: string;
  type: ListingType;
  title: string;
  eyebrow: string;
  city: string;
  region: string;
  image: string;
  short_description: string;
  price_cents: number;
  price_unit: string;
  tags: string[];
  profiles: { display_name: string; business_name: string | null } | null;
}

// `profiles!operator_id(...)` disambiguates the embed: since 0002 added a
// second FK from listings to profiles (reviewed_by), a bare `profiles(...)`
// is ambiguous ("more than one relationship was found"). Pin it to the
// operator_id foreign key so we get the listing's operator, not its reviewer.
const PENDING_COLUMNS =
  "id, slug, type, title, eyebrow, city, region, image, short_description, price_cents, price_unit, tags, profiles!operator_id(display_name, business_name)";

function ReviewCard({ listing, onDecided }: { listing: PendingListing; onDecided: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const approve = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.from("listings").update({ status: "published" }).eq("id", listing.id);
      if (error) throw error;
      toast(`${listing.title} published.`);
      onDecided();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't approve this listing.");
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("listings")
        .update({ status: "draft", review_note: note.trim() || "Changes requested — check with the operator for details." })
        .eq("id", listing.id);
      if (error) throw error;
      toast(`${listing.title} sent back for changes.`);
      onDecided();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send this listing back.");
      setBusy(false);
    }
  };

  const priceDisplay = `֏${Math.round(listing.price_cents / 100).toLocaleString()}`;

  return (
    <div className="grid gap-4 border border-basalt/10 bg-paper p-5 sm:grid-cols-[140px_1fr]">
      <img src={listing.image} alt="" className="h-28 w-full rounded object-cover sm:h-full" />
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/40">
              {typeLabels[listing.type]} · {listing.eyebrow}
            </p>
            <h3 className="mt-1 font-display text-2xl leading-tight">{listing.title}</h3>
          </div>
          <p className="text-right text-xs leading-5 text-basalt/50">
            by {listing.profiles?.business_name || listing.profiles?.display_name || "an operator"}
            <br />
            {priceDisplay} / {listing.price_unit}
          </p>
        </div>
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-basalt/50">
          <MapPin className="h-3.5 w-3.5 text-apricot" /> {listing.city}, {listing.region}
        </p>
        <p className="mt-3 text-sm leading-6 text-basalt/70">{listing.short_description}</p>
        {listing.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {listing.tags.map((tag) => (
              <span key={tag} className="border border-basalt/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-basalt/55">
                {tag}
              </span>
            ))}
          </div>
        )}

        {rejecting ? (
          <div className="mt-4 grid gap-2">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What needs to change? (shown to the operator)" className="text-sm" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="rounded-none border-destructive/30 text-destructive hover:bg-destructive/5" disabled={busy} onClick={reject}>
                {busy ? "Sending…" : "Send back"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={`/listing/${listing.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-none border border-basalt/20 bg-paper px-4 py-2 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Preview full listing
            </a>
            <Button size="sm" className="rounded-none bg-sevan text-white hover:bg-sevan/90" disabled={busy} onClick={approve}>
              <Check className="mr-1.5 h-3.5 w-3.5" /> Approve
            </Button>
            <Button size="sm" variant="outline" className="rounded-none border-destructive/30 text-destructive hover:bg-destructive/5" disabled={busy} onClick={() => setRejecting(true)}>
              <X className="mr-1.5 h-3.5 w-3.5" /> Request changes
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The pending-listing review queue (unchanged behavior, now its own panel). */
function ReviewsPanel({ onCount }: { onCount?: (n: number) => void }) {
  const [items, setItems] = useState<PendingListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("listings")
      .select(PENDING_COLUMNS)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) {
      setError(error.message);
      return;
    }
    const rows = (data ?? []) as unknown as PendingListing[];
    setItems(rows);
    setError(null);
    onCount?.(rows.length);
  }, [onCount]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <SectionHead title="Pending listings." sub="New stay, tour, and experience listings wait here until approved. Approving publishes a listing immediately; sending it back notifies the operator with your note so they can fix it and resubmit." />
      {error && (
        <div className="mb-6 flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {items === null ? (
        <p className="text-sm text-basalt/50">Loading…</p>
      ) : items.length === 0 ? (
        <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">Nothing waiting for review.</p>
      ) : (
        <div className="grid gap-4">
          {items.map((listing) => (
            <ReviewCard key={listing.id} listing={listing} onDecided={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-8">
      <h1 className="font-display text-4xl leading-[0.95] tracking-[-0.03em] sm:text-5xl">{title}</h1>
      <p className="mt-3 max-w-xl text-base leading-7 text-basalt/60">{sub}</p>
    </div>
  );
}

function StatTile({ n, label, onClick }: { n: number | string; label: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="border border-basalt/10 bg-paper p-5 text-left transition-colors hover:border-apricot/50">
      <p className="font-display text-4xl font-normal tabular-nums">{n}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-basalt/45">{label}</p>
    </button>
  );
}

type AdminSection = "overview" | "reviews" | "listings" | "accounts" | "support" | "messages" | "payouts" | "blog" | "site";
const ADMIN_SECTIONS: { key: AdminSection; label: string; icon: typeof Home }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "reviews", label: "Reviews", icon: ListChecks },
  { key: "listings", label: "Listings", icon: Package },
  { key: "accounts", label: "Accounts", icon: Users },
  { key: "support", label: "Support", icon: MessageSquare },
  { key: "messages", label: "All messages", icon: MessagesSquare },
  { key: "payouts", label: "Payouts", icon: Wallet },
  { key: "blog", label: "Blog", icon: Newspaper },
  { key: "site", label: "Site content", icon: Palette },
];

function OverviewPanel({ go }: { go: (s: AdminSection) => void }) {
  const [pending, setPending] = useState<number | null>(null);
  const [published, setPublished] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<number | null>(null);

  useEffect(() => {
    supabase.from("listings").select("id", { count: "exact", head: true }).eq("status", "pending").then(({ count }) => setPending(count ?? 0));
    supabase.from("listings").select("id", { count: "exact", head: true }).eq("status", "published").then(({ count }) => setPublished(count ?? 0));
    // Blog drafts (table may not exist yet until migration 0030 is run — degrade quietly).
    supabase.from("posts").select("id", { count: "exact", head: true }).eq("status", "draft").then(({ count, error }) => setDrafts(error ? 0 : count ?? 0));
  }, []);

  return (
    <div>
      <SectionHead title="Admin overview." sub="A snapshot of what needs your attention. Jump into any area from here." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile n={pending ?? "—"} label="Pending reviews" onClick={() => go("reviews")} />
        <StatTile n={published ?? "—"} label="Published listings" onClick={() => go("reviews")} />
        <StatTile n={drafts ?? "—"} label="Blog drafts" onClick={() => go("blog")} />
      </div>
      <div className="mt-8 flex flex-wrap gap-2">
        <Button onClick={() => go("blog")} className="rounded-none bg-apricot text-white hover:bg-apricot/90">Write a blog post</Button>
        <Button onClick={() => go("support")} variant="outline" className="rounded-none">Open support inbox</Button>
        <Button onClick={() => go("payouts")} variant="outline" className="rounded-none">Review payouts</Button>
      </div>
    </div>
  );
}

function AdminConsole() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { user } = useAuth();

  useDocumentMeta({
    title: "Admin | Revamp Vacations",
    description: "Revamp Vacations admin console.",
    canonicalPath: "/admin",
    noindex: true,
  });

  const initial = useMemo<AdminSection>(() => {
    const s = new URLSearchParams(search).get("section");
    return ADMIN_SECTIONS.some((x) => x.key === s) ? (s as AdminSection) : "overview";
  }, [search]);
  const [section, setSectionState] = useState<AdminSection>(initial);
  useEffect(() => setSectionState(initial), [initial]);
  const go = (s: AdminSection) => {
    setSectionState(s);
    navigate(s === "overview" ? "/admin" : `/admin?section=${s}`);
  };

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader minimal />
      <main className="container py-10 lg:py-14">
        <div className="grid gap-8 lg:grid-cols-[210px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-[96px] lg:self-start">
            <p className="hidden px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-basalt/40 lg:block">Admin</p>
            <nav className="mt-0 flex gap-1 overflow-x-auto pb-1 lg:mt-3 lg:flex-col lg:overflow-visible lg:pb-0">
              <Link href="/" className="flex items-center gap-2.5 whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-basalt/60 transition-colors hover:bg-chalk hover:text-basalt">
                <Home className="h-4 w-4" /> Homepage
              </Link>
              {ADMIN_SECTIONS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => go(key)}
                  aria-current={section === key}
                  className={cn(
                    "flex items-center gap-2.5 whitespace-nowrap px-3 py-2.5 text-sm font-semibold transition-colors",
                    section === key ? "bg-basalt text-paper" : "text-basalt/60 hover:bg-chalk hover:text-basalt",
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </nav>
          </aside>

          <div className="min-w-0">
            {section === "overview" && <OverviewPanel go={go} />}
            {section === "reviews" && <ReviewsPanel />}
            {section === "listings" && <AdminListings />}
            {section === "accounts" && <AdminAccounts />}
            {section === "support" && <AdminSupportInbox />}
            {section === "messages" && (
              <div>
                <SectionHead title="All messages" sub="Every guest ↔ host conversation, for oversight. Flagged messages (contact details / off-platform hints) are marked. You can reply as Revamp to step in." />
                {user && <Inbox userId={user.id} admin />}
              </div>
            )}
            {section === "payouts" && <AdminPayouts />}
            {section === "blog" && <AdminBlog />}
            {section === "site" && <AdminSiteContent />}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export default function AdminReview() {
  return (
    <RequireRole role="admin">
      <AdminConsole />
    </RequireRole>
  );
}
