/**
 * The traveler/operator account area — the signed-in home for anyone with an
 * account, regardless of role (operators manage listings under /dashboard;
 * this is the personal side both roles share). Four tabs:
 *
 *   Trips     — reservations. A scaffold for now; it fills in once the booking
 *               loop ships (Phase 2 of the account flow, PayLink checkout).
 *   Saved     — bookmarked listings, backed by SavedPlacesContext /
 *               supabase/migrations/0009_saved_places.sql.
 *   Profile   — edit display name, bio, and (operators) business name via
 *               AuthContext.updateProfile.
 *   Security  — change password (AuthContext.updatePassword) and sign out.
 *
 * Not RequireRole: this page isn't role-gated, it's sign-in-gated. Signed-out
 * visitors are bounced to /login, matching RequireRole's own redirect.
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Bookmark, LogOut, MapPin, MessageSquare, ShieldCheck, Star, Ticket, User as UserIcon } from "lucide-react";
import { Inbox } from "@/components/Inbox";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ListingCard } from "@/components/ListingCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PasswordInput } from "@/components/PasswordInput";
import { useAuth } from "@/contexts/AuthContext";
import { useSavedPlaces } from "@/contexts/SavedPlacesContext";
import { useListings } from "@/contexts/ListingsContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { supabase } from "@/lib/supabase";
import { confirmCheckout, cancelBooking, ensureBookingThread } from "@/lib/api";
import { uploadImage } from "@/lib/imageUpload";
import { trackEvent } from "@/lib/analytics";
import type { BookingStatus } from "@shared/bookings";
import { toast } from "sonner";

// --- booking display helpers ------------------------------------------------
interface TripRow {
  id: string;
  start_date: string;
  end_date: string;
  guests: number;
  amount_cents: number;
  currency: string;
  status: BookingStatus;
  created_at: string;
  listing_id: string;
  listings: { slug: string; title: string; image: string; city: string; region: string; type: string } | null;
}

const STATUS_STYLE: Record<BookingStatus, { label: string; className: string }> = {
  pending_payment: { label: "Awaiting payment", className: "bg-tuff/15 text-tuff" },
  confirmed: { label: "Confirmed", className: "bg-sevan/15 text-sevan" },
  completed: { label: "Completed", className: "bg-basalt/10 text-basalt/60" },
  payment_failed: { label: "Payment failed", className: "bg-destructive/10 text-destructive" },
  cancelled: { label: "Cancelled", className: "bg-destructive/10 text-destructive" },
  refunded: { label: "Refunded", className: "bg-basalt/10 text-basalt/60" },
  expired: { label: "Expired", className: "bg-basalt/10 text-basalt/50" },
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function fmtMoney(cents: number, currency: string): string {
  const major = cents / 100;
  const n = major % 1 === 0 ? major.toString() : major.toFixed(2);
  return currency === "USD" ? `$${n}` : currency === "AMD" ? `֏${n}` : `${n} ${currency}`;
}

const VALID_TABS = ["trips", "messages", "saved", "profile", "security"] as const;
type TabKey = (typeof VALID_TABS)[number];

export function ProfileTab() {
  const { profile, user, updateProfile } = useAuth();
  const isOperator = profile?.role === "operator";
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [businessName, setBusinessName] = useState(profile?.businessName ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [logoUrl, setLogoUrl] = useState(profile?.logoUrl ?? "");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-seed if the profile loads/changes under us.
  useEffect(() => {
    setDisplayName(profile?.displayName ?? "");
    setBusinessName(profile?.businessName ?? "");
    setBio(profile?.bio ?? "");
    setLogoUrl(profile?.logoUrl ?? "");
  }, [profile?.displayName, profile?.businessName, profile?.bio, profile?.logoUrl]);

  const onLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadingLogo(true);
    try {
      setLogoUrl(await uploadImage(file, user.id));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't upload the logo.");
    } finally {
      setUploadingLogo(false);
      e.target.value = "";
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!displayName.trim()) {
      toast("Your name can't be blank.");
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        displayName: displayName.trim(),
        bio: bio.trim() || null,
        ...(isOperator
          ? {
              businessName: businessName.trim() || null,
              // Only write logo_url when it actually changed (keeps saves working
              // even before migration 0037 adds the column).
              ...(logoUrl !== (profile?.logoUrl ?? "") ? { logoUrl: logoUrl || null } : {}),
            }
          : {}),
      });
      toast("Profile updated.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save your profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="grid max-w-xl gap-5">
      <div className="grid gap-2">
        <Label htmlFor="acc-name" className="text-sm font-semibold">Name</Label>
        <Input id="acc-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="h-11 rounded-none" />
      </div>
      {isOperator && (
        <div className="grid gap-2">
          <Label htmlFor="acc-business" className="text-sm font-semibold">
            Business / company name <span className="font-normal text-basalt/45">(shown on your listings)</span>
          </Label>
          <Input id="acc-business" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Aragats Guesthouse LLC" className="h-11 rounded-none" />
        </div>
      )}
      {isOperator && (
        <div className="grid gap-2">
          <Label className="text-sm font-semibold">Logo <span className="font-normal text-basalt/45">(shown on your listings)</span></Label>
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <img src={logoUrl} alt="Your logo" className="h-16 w-16 rounded-full border border-basalt/15 object-cover" />
            ) : (
              <div className="grid h-16 w-16 place-items-center rounded-full border border-dashed border-basalt/25 text-[10px] font-semibold uppercase tracking-wide text-basalt/40">Logo</div>
            )}
            <div className="flex items-center gap-3">
              <label className="cursor-pointer rounded-none border border-basalt/15 px-3 py-2 text-sm font-semibold transition-colors hover:border-apricot hover:text-apricot">
                {uploadingLogo ? "Uploading…" : logoUrl ? "Replace" : "Upload logo"}
                <input type="file" accept="image/*" className="hidden" onChange={onLogoFile} disabled={uploadingLogo} />
              </label>
              {logoUrl && (
                <button type="button" onClick={() => setLogoUrl("")} className="text-sm font-semibold text-basalt/45 hover:text-destructive">Remove</button>
              )}
            </div>
          </div>
          <p className="text-xs text-basalt/45">A square image works best. Shown next to your business name on your listings.</p>
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="acc-bio" className="text-sm font-semibold">
          Bio <span className="font-normal text-basalt/45">(optional)</span>
        </Label>
        <Textarea id="acc-bio" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} placeholder={isOperator ? "Tell travelers about your place and what makes it worth the trip." : "A line about how you like to travel."} className="rounded-none text-base" />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-semibold">Email</Label>
        <p className="text-sm text-basalt/55">{user?.email}</p>
      </div>
      <div>
        <Button type="submit" disabled={saving} className="rounded-none bg-apricot text-white hover:bg-apricot/90">
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

export function SecurityTab() {
  const { updatePassword, signOut } = useAuth();
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 6) {
      toast("Use at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      toast("Those two passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      await updatePassword(password);
      setPassword("");
      setConfirm("");
      toast("Password updated.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update your password.");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    toast("Signed out.");
    navigate("/");
  };

  return (
    <div className="grid max-w-xl gap-8">
      <form onSubmit={save} className="grid gap-5">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Change password</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="acc-pw" className="text-sm font-semibold">New password</Label>
          <PasswordInput id="acc-pw" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="h-11 rounded-none" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="acc-pw2" className="text-sm font-semibold">Confirm new password</Label>
          <PasswordInput id="acc-pw2" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className="h-11 rounded-none" />
        </div>
        <div>
          <Button type="submit" disabled={saving} className="rounded-none bg-apricot text-white hover:bg-apricot/90">
            {saving ? "Updating…" : "Update password"}
          </Button>
        </div>
      </form>

      <div className="border-t border-basalt/10 pt-6">
        <Button variant="outline" onClick={handleSignOut} className="rounded-none border-basalt/20">
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
      </div>
    </div>
  );
}

function SavedTab() {
  const { savedIds, loading } = useSavedPlaces();
  const { listings } = useListings();
  const saved = useMemo(() => listings.filter((l) => savedIds.has(l.id)), [listings, savedIds]);

  if (loading) return <p className="text-sm text-basalt/50">Loading your saved places…</p>;

  if (saved.length === 0) {
    return (
      <div className="border border-dashed border-basalt/20 bg-chalk px-6 py-14 text-center">
        <Bookmark className="mx-auto h-7 w-7 text-basalt/30" />
        <h3 className="mt-4 font-display text-2xl">Nothing saved yet.</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-basalt/55">
          Tap the bookmark on any stay, tour, or experience and it'll wait for you here.
        </p>
        <Button asChild className="mt-6 rounded-none bg-apricot text-white hover:bg-apricot/90">
          <Link href="/explore">Start exploring</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
      {saved.map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}

function TripsTab({ reloadKey }: { reloadKey: number }) {
  const { user } = useAuth();
  const search = useSearch();
  const [, navigate] = useLocation();
  const [trips, setTrips] = useState<TripRow[] | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [messaging, setMessaging] = useState<string | null>(null);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [openReview, setOpenReview] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  const todayIso = new Date().toISOString().slice(0, 10);
  const canCancel = (t: TripRow) => (t.status === "pending_payment" || t.status === "confirmed") && t.start_date >= todayIso;
  // Reviewable once the trip has ended (and paid), one per booking.
  const canReview = (t: TripRow) => (t.status === "completed" || (t.status === "confirmed" && t.end_date < todayIso)) && !reviewedIds.has(t.id);

  // Which of this traveler's bookings already have a review.
  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from("reviews")
      .select("booking_id")
      .eq("traveler_id", user.id)
      .then(({ data }) => {
        if (active) setReviewedIds(new Set((data ?? []).map((r) => r.booking_id as string)));
      });
    return () => {
      active = false;
    };
  }, [user, reloadKey]);

  // Deep link from the review-request email: /account?tab=trips&review=<bookingId>.
  useEffect(() => {
    const id = new URLSearchParams(search).get("review");
    if (id) setOpenReview(id);
  }, [search]);

  const submitReview = async (t: TripRow) => {
    if (!user) return;
    setSavingReview(true);
    try {
      const { error } = await supabase.from("reviews").insert({ booking_id: t.id, listing_id: t.listing_id, traveler_id: user.id, rating, body: body.trim() });
      if (error) throw new Error(error.message);
      setReviewedIds((prev) => new Set(prev).add(t.id));
      setOpenReview(null);
      setBody("");
      setRating(5);
      toast("Thanks for your review!");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save your review.");
    } finally {
      setSavingReview(false);
    }
  };

  const messageHost = async (t: TripRow) => {
    setMessaging(t.id);
    try {
      await ensureBookingThread(t.id);
      navigate("/account?tab=messages");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't open the conversation.");
    } finally {
      setMessaging(null);
    }
  };

  const cancel = async (t: TripRow) => {
    if (!window.confirm(`Cancel your booking for ${t.listings?.title ?? "this listing"}? This frees the dates.`)) return;
    setCancelling(t.id);
    try {
      const { refundCents } = await cancelBooking(t.id);
      setTrips((prev) => (prev ? prev.map((x) => (x.id === t.id ? { ...x, status: "cancelled" } : x)) : prev));
      toast(refundCents > 0 ? `Booking cancelled — ${fmtMoney(refundCents, t.currency)} will be refunded.` : "Booking cancelled — no refund applies under this policy.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't cancel that booking.");
    } finally {
      setCancelling(null);
    }
  };

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from("bookings")
      .select("id, start_date, end_date, guests, amount_cents, currency, status, created_at, listing_id, listings(slug, title, image, city, region, type)")
      .eq("traveler_id", user.id)
      .order("start_date", { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("Failed to load trips", error);
          setTrips([]);
          return;
        }
        setTrips((data ?? []) as unknown as TripRow[]);
      });
    return () => {
      active = false;
    };
  }, [user, reloadKey]);

  if (trips === null) return <p className="text-sm text-basalt/50">Loading your trips…</p>;

  if (trips.length === 0) {
    return (
      <div className="border border-dashed border-basalt/20 bg-chalk px-6 py-14 text-center">
        <Ticket className="mx-auto h-7 w-7 text-basalt/30" />
        <h3 className="mt-4 font-display text-2xl">No trips yet.</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-basalt/55">
          When you book a stay, tour, or experience, your upcoming and past trips will live here.
        </p>
        <Button asChild className="mt-6 rounded-none bg-apricot text-white hover:bg-apricot/90">
          <Link href="/explore">Find something to book</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {trips.map((t) => {
        const s = STATUS_STYLE[t.status] ?? STATUS_STYLE.pending_payment;
        return (
          <div key={t.id} className="border border-basalt/10 bg-paper p-4">
          <div className="grid gap-4 sm:grid-cols-[96px_1fr_auto] sm:items-center">
            {t.listings ? (
              <Link href={`/listing/${t.listings.slug}`} className="block">
                <img src={t.listings.image} alt="" className="h-20 w-full rounded object-cover sm:h-24" />
              </Link>
            ) : (
              <div className="h-20 w-full rounded bg-basalt/5 sm:h-24" />
            )}
            <div>
              <span className={cnStatus(s.className)}>{s.label}</span>
              <h3 className="mt-1.5 font-display text-xl leading-tight">
                {t.listings ? (
                  <Link href={`/listing/${t.listings.slug}`} className="hover:text-apricot">{t.listings.title}</Link>
                ) : (
                  "Listing"
                )}
              </h3>
              <p className="mt-1 text-sm text-basalt/55">
                {fmtDate(t.start_date)} → {fmtDate(t.end_date)} · {t.guests} {t.guests === 1 ? "guest" : "guests"}
                {t.listings ? ` · ${t.listings.city}, ${t.listings.region}` : ""}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
              <p className="font-display text-lg font-normal sm:text-xl">{fmtMoney(t.amount_cents, t.currency)}</p>
              {canCancel(t) && (
                <button
                  type="button"
                  disabled={cancelling === t.id}
                  onClick={() => cancel(t)}
                  className="text-xs font-semibold text-basalt/45 underline-offset-2 transition-colors hover:text-destructive hover:underline disabled:opacity-50"
                >
                  {cancelling === t.id ? "Cancelling…" : "Cancel"}
                </button>
              )}
              <button
                type="button"
                disabled={messaging === t.id}
                onClick={() => messageHost(t)}
                className="text-xs font-semibold text-apricot underline-offset-2 hover:underline disabled:opacity-50"
              >
                {messaging === t.id ? "Opening…" : "Message host"}
              </button>
              {reviewedIds.has(t.id) && <span className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/45"><Star className="h-3.5 w-3.5 fill-apricot text-apricot" /> Reviewed</span>}
              {canReview(t) && openReview !== t.id && (
                <button type="button" onClick={() => setOpenReview(t.id)} className="text-xs font-semibold text-apricot underline-offset-2 hover:underline">Leave a review</button>
              )}
            </div>
          </div>

          {canReview(t) && openReview === t.id && (
            <div className="mt-4 border-t border-basalt/10 pt-4">
              <p className="text-sm font-semibold">How was your stay?</p>
              <div className="mt-2 flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => setRating(n)} className="p-0.5">
                    <Star className={`h-6 w-6 ${n <= rating ? "fill-apricot text-apricot" : "text-basalt/25"}`} />
                  </button>
                ))}
              </div>
              <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Share a little about your experience (optional)." className="mt-3 rounded-none text-base" />
              <div className="mt-3 flex items-center gap-3">
                <Button onClick={() => submitReview(t)} disabled={savingReview} className="rounded-none bg-apricot text-white hover:bg-apricot/90">{savingReview ? "Posting…" : "Post review"}</Button>
                <button type="button" onClick={() => setOpenReview(null)} className="text-sm font-semibold text-basalt/45 hover:text-basalt">Cancel</button>
              </div>
            </div>
          )}
          </div>
        );
      })}
    </div>
  );
}

function cnStatus(extra: string): string {
  return `inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${extra}`;
}

export default function Account() {
  const { user, profile, loading } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();

  useDocumentMeta({
    title: "Your account | Revamp Vacations",
    description: "Your trips, saved places, and profile.",
    canonicalPath: "/account",
    noindex: true,
  });

  const initialTab = useMemo<TabKey>(() => {
    const requested = new URLSearchParams(search).get("tab");
    return (VALID_TABS as readonly string[]).includes(requested ?? "") ? (requested as TabKey) : "trips";
  }, [search]);
  const [tab, setTab] = useState<TabKey>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const [tripsReload, setTripsReload] = useState(0);

  // Sign-in gate (mirrors RequireRole, without the role check).
  useEffect(() => {
    if (!loading && !user) navigate("/login");
  }, [loading, user, navigate]);

  // Server-verified booking confirmation. PayLink has no webhook, so we poll on
  // every account load (catches a payment made in a since-closed tab) and,
  // returning from checkout (?checkout=return), report the outcome. The redirect
  // itself confirms nothing — the server checks PayLink and flips the booking.
  const isReturn = new URLSearchParams(search).get("checkout") === "return";
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;
    let active = true;
    confirmCheckout()
      .then((r) => {
        if (!active) return;
        if (r.confirmed > 0) {
          // GA funnel: purchase (fires once — a second confirm reports 0).
          trackEvent("purchase", {
            transaction_id: r.bookingIds?.[0] ?? `booking_${Date.now()}`,
            value: r.amountCents ? Math.round(r.amountCents / 100) : undefined,
            currency: r.currency ?? "AMD",
            items: r.confirmed,
          });
          toast(r.confirmed === 1 ? "Booking confirmed — your trip is set!" : `${r.confirmed} bookings confirmed!`);
          setTab("trips");
          setTripsReload((k) => k + 1);
        } else if (isReturn) {
          toast(r.pending ? "Payment received — we're still confirming it. Your trip will appear here shortly." : "We couldn't find a completed payment yet. If you paid, refresh in a moment.");
          setTab("trips");
        }
      })
      .catch(() => {
        /* nothing pending to confirm, or offline — stay quiet */
      });
    return () => {
      active = false;
    };
  }, [user?.id, isReturn]);

  if (loading || !user) {
    return (
      <div className="container py-24 text-center">
        <p className="eyebrow">Checking access</p>
        <h1 className="mt-4 font-display text-4xl">One moment.</h1>
      </div>
    );
  }

  const first = (profile?.displayName || "there").split(" ")[0];

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-12 lg:py-16">
        <p className="eyebrow">Your account</p>
        <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl">Hi {first}.</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-basalt/60">
          Your trips, the places you've saved, and your profile — all in one spot.
        </p>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mt-10">
          <TabsList className="flex h-auto flex-wrap justify-start gap-1 rounded-none border-b border-basalt/10 bg-transparent p-0">
            {[
              { key: "trips", label: "Trips", icon: Ticket },
              { key: "messages", label: "Messages", icon: MessageSquare },
              { key: "saved", label: "Saved", icon: Bookmark },
              { key: "profile", label: "Profile", icon: UserIcon },
              { key: "security", label: "Security", icon: ShieldCheck },
            ].map(({ key, label, icon: Icon }) => (
              <TabsTrigger
                key={key}
                value={key}
                className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 text-sm font-semibold text-basalt/55 shadow-none data-[state=active]:border-apricot data-[state=active]:bg-transparent data-[state=active]:text-basalt data-[state=active]:shadow-none"
              >
                <Icon className="mr-2 h-4 w-4" /> {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="trips" className="mt-8"><TripsTab reloadKey={tripsReload} /></TabsContent>
          <TabsContent value="messages" className="mt-8">{user && <Inbox userId={user.id} />}</TabsContent>
          <TabsContent value="saved" className="mt-8"><SavedTab /></TabsContent>
          <TabsContent value="profile" className="mt-8"><ProfileTab /></TabsContent>
          <TabsContent value="security" className="mt-8"><SecurityTab /></TabsContent>
        </Tabs>

        {profile?.role === "operator" && (
          <p className="mt-10 inline-flex items-center gap-1.5 text-sm text-basalt/55">
            <MapPin className="h-4 w-4 text-apricot" /> Managing listings?{" "}
            <Link href="/dashboard" className="font-semibold text-apricot hover:underline">Go to your dashboard</Link>
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
