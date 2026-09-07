/**
 * Admin review queue — approve or send back a pending listing before it
 * goes live (see supabase/migrations/0002_review_gate_and_admin.sql for
 * the schema/RLS/trigger this depends on, and Dashboard.tsx for the
 * operator side of the same workflow). Wrapped in the existing
 * RequireRole role="admin" — there's no self-serve admin signup; the
 * migration's header comment documents the one-line SQL to promote an
 * account after it's signed up normally.
 *
 * Queries Supabase directly rather than through ListingsContext: this view
 * needs every pending listing regardless of owner (granted by the
 * "admins can read every listing" RLS policy) plus the submitting
 * operator's name embedded in the same query — ListingsContext's shared
 * fetch is scoped to what browsing pages need and doesn't carry that join.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, MapPin, X } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { RequireRole } from "@/components/RequireRole";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { typeLabels, ListingType } from "@shared/listings";
import { toast } from "sonner";

interface PendingListing {
  id: string;
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
  "id, type, title, eyebrow, city, region, image, short_description, price_cents, price_unit, tags, profiles!operator_id(display_name, business_name)";

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

  const priceDisplay = listing.price_cents % 100 === 0 ? `$${listing.price_cents / 100}` : `$${(listing.price_cents / 100).toFixed(2)}`;

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
          <div className="mt-4 flex gap-2">
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

function AdminReviewContent() {
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
    setItems((data ?? []) as unknown as PendingListing[]);
    setError(null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-12 lg:py-16">
        <p className="eyebrow">Review queue</p>
        <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl">Pending listings.</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-basalt/60">
          New stay and tour listings wait here until approved. Approving publishes a listing immediately; sending it back notifies the operator with your note so they can fix it and resubmit.
        </p>

        {error && (
          <div className="mt-6 flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {items === null ? (
          <p className="mt-8 text-sm text-basalt/50">Loading…</p>
        ) : items.length === 0 ? (
          <p className="mt-8 border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">Nothing waiting for review.</p>
        ) : (
          <div className="mt-8 grid gap-4">
            {items.map((listing) => (
              <ReviewCard key={listing.id} listing={listing} onDecided={load} />
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

export default function AdminReview() {
  return (
    <RequireRole role="admin">
      <AdminReviewContent />
    </RequireRole>
  );
}
