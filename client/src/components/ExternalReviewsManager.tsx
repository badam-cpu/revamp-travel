/**
 * Operator UI (Dashboard → Integrations) to bring in external reviews:
 *   - Google Business: set the business Place ID (profiles.google_place_id) —
 *     reviews are then fetched live and shown on the operator's listings.
 *   - Airbnb: self-import your own reviews (no Airbnb API exists); shown labeled
 *     "imported from Airbnb, added by the host".
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ExternalLink, Star, Trash2 } from "lucide-react";
import { listHostReviews, addHostReview, deleteHostReview, type HostReview, type HostReviewSource } from "@/lib/externalReviews";
import { GooglePlaceFinder } from "@/components/GooglePlaceFinder";

const SOURCE_LABELS: Record<HostReviewSource, string> = { airbnb: "Airbnb", getyourguide: "GetYourGuide", booking: "Booking.com" };

export function ExternalReviewsManager() {
  const { user, profile, updateProfile } = useAuth();
  const { listings } = useListings();
  const myListings = listings.filter((l) => (l as { operatorId?: string }).operatorId === user?.id);
  const listingTitle = (id: string | null) => (id ? myListings.find((l) => (l as { id: string }).id === id)?.title ?? "a listing" : "All my listings");
  const [placeId, setPlaceId] = useState(profile?.googlePlaceId ?? "");
  const [savingPlace, setSavingPlace] = useState(false);

  const [reviews, setReviews] = useState<HostReview[]>([]);
  const [source, setSource] = useState<HostReviewSource>("airbnb");
  const [name, setName] = useState("");
  const [rating, setRating] = useState(5);
  const [date, setDate] = useState("");
  const [body, setBody] = useState("");
  const [listingId, setListingId] = useState<string>(""); // "" = all listings
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    if (user) listHostReviews(user.id).then(setReviews);
  }, [user]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setPlaceId(profile?.googlePlaceId ?? "");
  }, [profile?.googlePlaceId]);

  const savePlaceId = async (idOverride?: string, name?: string) => {
    const id = idOverride ?? placeId.trim();
    setSavingPlace(true);
    try {
      await updateProfile({ googlePlaceId: id || null });
      if (idOverride) setPlaceId(idOverride);
      toast(id ? `Google Business connected${name ? ` — ${name}` : ""}.` : "Google Business disconnected.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSavingPlace(false);
    }
  };

  const add = async () => {
    if (!user || !name.trim() || !body.trim()) {
      toast("Add at least a reviewer name and the review text.");
      return;
    }
    setAdding(true);
    try {
      await addHostReview(user.id, { source, reviewerName: name.trim(), rating, body: body.trim(), reviewDate: date || null, listingId: listingId || null });
      setName("");
      setBody("");
      setDate("");
      setRating(5);
      toast("Review added.");
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't add the review.");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteHostReview(id);
      setReviews((r) => r.filter((x) => x.id !== id));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't remove.");
    }
  };

  return (
    <div className="grid gap-6 border border-basalt/12 bg-paper p-6">
      <div>
        <p className="font-display text-lg leading-tight">Reviews from other platforms</p>
        <p className="mt-1 text-sm text-basalt/60">Show your Google, Airbnb, and GetYourGuide reputation on your Revamp listings — clearly attributed, alongside your Revamp reviews.</p>
      </div>

      {/* Google Business */}
      <div className="grid gap-2 border-t border-basalt/10 pt-5">
        <p className="text-sm font-bold uppercase tracking-[0.1em] text-basalt/50">Google Business</p>
        <p className="text-xs text-basalt/55">Search your business below and pick it — we'll capture the Google details automatically. Your Google rating and latest reviews then appear on your listings.</p>
        <div className="max-w-md">
          <Label className="mb-1.5 block text-xs font-semibold text-basalt/60">Search your business on Google</Label>
          <GooglePlaceFinder onFound={(r) => savePlaceId(r.id, r.name)} />
        </div>
        {profile?.googlePlaceId && (
          <p className="text-xs text-emerald-700">Connected · <span className="font-mono text-basalt/50">{profile.googlePlaceId}</span> <button type="button" onClick={() => savePlaceId("")} className="ml-1 font-semibold text-basalt/45 hover:text-destructive">Disconnect</button></p>
        )}
        <details className="text-xs text-basalt/50">
          <summary className="cursor-pointer font-semibold text-basalt/55">Or paste a Place ID manually</summary>
          <div className="mt-2 flex items-end gap-2">
            <Input value={placeId} onChange={(e) => setPlaceId(e.target.value)} placeholder="ChIJ… (Google Place ID)" className="h-10 max-w-xs rounded-none font-mono text-sm" />
            <Button onClick={() => savePlaceId()} disabled={savingPlace} variant="outline" className="h-10 rounded-none border-basalt/20">Save</Button>
            <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-apricot hover:underline">Finder <ExternalLink className="h-3 w-3" /></a>
          </div>
        </details>
      </div>

      {/* Self-imported platform reviews (Airbnb / GetYourGuide / Booking.com) */}
      <div className="grid gap-3 border-t border-basalt/10 pt-5">
        <p className="text-sm font-bold uppercase tracking-[0.1em] text-basalt/50">Airbnb &amp; GetYourGuide reviews</p>
        <p className="text-xs text-basalt/55">These platforms have no import API, so add your own reviews here (Airbnb for stays, GetYourGuide for tours). They'll show as "imported from {SOURCE_LABELS[source]} — added by the host". Only add real reviews you received.</p>
        <div className="grid gap-2 border border-basalt/10 bg-chalk/40 p-4">
          <div className="grid gap-1">
            <Label className="text-xs font-semibold text-basalt/60">Source</Label>
            <select value={source} onChange={(e) => setSource(e.target.value as HostReviewSource)} className="h-10 max-w-xs rounded-none border border-basalt/20 bg-paper px-2 text-sm">
              {(Object.keys(SOURCE_LABELS) as HostReviewSource[]).map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reviewer first name" className="h-10 rounded-none" />
            <select value={rating} onChange={(e) => setRating(Number(e.target.value))} className="h-10 rounded-none border border-basalt/20 bg-paper px-2 text-sm">
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}
            </select>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-none" />
          </div>
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Review text" className="rounded-none text-base" />
          <div className="grid gap-1">
            <Label className="text-xs font-semibold text-basalt/60">Show on</Label>
            <select value={listingId} onChange={(e) => setListingId(e.target.value)} className="h-10 max-w-md rounded-none border border-basalt/20 bg-paper px-2 text-sm">
              <option value="">All my listings</option>
              {myListings.map((l) => <option key={l.id} value={(l as { id: string }).id}>{l.title}</option>)}
            </select>
          </div>
          <div><Button onClick={add} disabled={adding} variant="outline" className="rounded-none border-basalt/20">{adding ? "Adding…" : `+ Add ${SOURCE_LABELS[source]} review`}</Button></div>
        </div>

        {reviews.length > 0 && (
          <ul className="grid gap-2">
            {reviews.map((r) => (
              <li key={r.id} className="flex items-start gap-3 border border-basalt/10 bg-paper px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-basalt">{r.reviewerName}</span>
                    <span className="inline-flex text-apricot">{Array.from({ length: r.rating ?? 0 }).map((_, i) => <Star key={i} className="h-3 w-3 fill-apricot" />)}</span>
                    <span className="text-basalt/40">{SOURCE_LABELS[r.source]}{r.reviewDate ? ` · ${r.reviewDate}` : ""}</span>
                    <span className="rounded-full bg-basalt/5 px-2 py-0.5 text-[10px] font-semibold text-basalt/50">{listingTitle(r.listingId)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-basalt/70">{r.body}</p>
                </div>
                <button type="button" onClick={() => remove(r.id)} className="shrink-0 text-basalt/40 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
