/**
 * Admin — curate restaurant recommendations (the free "Eat" guide). Admins add a
 * spot by searching Google (Places API New), which pre-fills name, rating,
 * address, website and price band; the admin sets cuisine + neighborhood and
 * saves it as a type='eat' listing (owned by the admin, published, price 0).
 * Operators can't create these — only admins, via the RLS policy in 0051.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { adminPlaceDetails, ApiError } from "@/lib/api";
import { slugify } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Star, Trash2, Utensils } from "lucide-react";
import { GooglePlaceFinder } from "@/components/GooglePlaceFinder";

interface EatRow {
  id: string;
  title: string;
  slug: string;
  cuisine: string | null;
  price_band: string | null;
  city: string | null;
  neighborhood: string | null;
  google_rating: number | null;
  google_rating_count: number | null;
  status: string;
}

const BLANK = {
  placeId: "", title: "", cuisine: "", priceBand: "" as "" | "$" | "$$" | "$$$",
  city: "", region: "Yerevan", neighborhood: "", image: "", website: "",
  shortDescription: "", address: "", googleRating: null as number | null, googleRatingCount: null as number | null,
  lat: null as number | null, lng: null as number | null,
};

export function AdminEateries() {
  const { user } = useAuth();
  const [rows, setRows] = useState<EatRow[] | null>(null);
  const [f, setF] = useState({ ...BLANK });
  const [enriching, setEnriching] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("listings")
      .select("id, title, slug, cuisine, price_band, city, neighborhood, google_rating, google_rating_count, status")
      .eq("type", "eat")
      .order("title");
    setRows((data ?? []) as EatRow[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (patch: Partial<typeof BLANK>) => setF((prev) => ({ ...prev, ...patch }));

  const onFound = async (r: { id: string; name: string }) => {
    // Fill the name straight away so curation still works even if the
    // server-side Google enrichment call fails (e.g. key not configured).
    set({ title: r.name, placeId: r.id });
    setEnriching(true);
    try {
      const d = await adminPlaceDetails(r.id);
      set({
        placeId: d.placeId,
        title: d.name || r.name,
        address: d.address ?? "",
        website: d.website ?? "",
        priceBand: d.priceBand ?? "",
        googleRating: d.rating,
        googleRatingCount: d.ratingCount,
        lat: d.lat,
        lng: d.lng,
        shortDescription: d.summary ?? "",
      });
      toast(`Pulled "${d.name}" from Google — set cuisine and neighborhood, then save.`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't fetch that place. Fill the details in manually and save.");
    } finally {
      setEnriching(false);
    }
  };

  const save = async () => {
    if (!user) return;
    if (!f.title.trim() || !f.city.trim() || !f.image.trim()) {
      toast("Add at least a name, city, and photo URL.");
      return;
    }
    setSaving(true);
    try {
      const slug = `${slugify(f.title)}-${Math.random().toString(36).slice(2, 6)}`;
      const { error } = await supabase.from("listings").insert({
        operator_id: user.id,
        type: "eat",
        status: "published",
        slug,
        title: f.title.trim(),
        eyebrow: f.cuisine.trim() || "Restaurant",
        city: f.city.trim(),
        region: f.region.trim() || "Yerevan",
        address: f.address.trim() || null,
        lat: f.lat ?? 0,
        lng: f.lng ?? 0,
        image: f.image.trim(),
        gallery: [f.image.trim()],
        short_description: f.shortDescription.trim() || `A Revamp-recommended spot in ${f.city.trim()}.`,
        long_description: f.shortDescription.trim(),
        price_cents: 0,
        price_unit: "",
        tags: [f.cuisine.trim()].filter(Boolean),
        amenities: [],
        facts: [],
        accent: "apricot",
        cuisine: f.cuisine.trim() || null,
        price_band: f.priceBand || null,
        website: f.website.trim() || null,
        google_place_id: f.placeId || null,
        google_rating: f.googleRating,
        google_rating_count: f.googleRatingCount,
        neighborhood: f.neighborhood.trim() || null,
      });
      if (error) throw new Error(error.message);
      toast("Restaurant added to the guide.");
      setF({ ...BLANK });
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, title: string) => {
    if (!window.confirm(`Remove "${title}" from the guide?`)) return;
    try {
      const { error } = await supabase.from("listings").delete().eq("id", id);
      if (error) throw new Error(error.message);
      setRows((r) => (r ? r.filter((x) => x.id !== id) : r));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't remove.");
    }
  };

  return (
    <div>
      <div className="mb-6">
        <p className="eyebrow">Eat guide</p>
        <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Restaurant recommendations.</h2>
        <p className="mt-2 max-w-xl text-sm text-basalt/55">Free, curated picks — no bookings, no operator accounts. Search a place on Google to pull its rating, address and price band, then add a cuisine and neighborhood.</p>
      </div>

      <div className="grid gap-3 border border-basalt/12 bg-paper p-5">
        <div>
          <Label className="mb-1.5 block text-xs font-semibold text-basalt/60">Find on Google</Label>
          <GooglePlaceFinder onFound={onFound} />
          {enriching && <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-basalt/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching details…</p>}
        </div>

        <div className="grid gap-3 border-t border-basalt/10 pt-4 sm:grid-cols-2">
          <Field label="Name"><Input value={f.title} onChange={(e) => set({ title: e.target.value })} className="h-10 rounded-none" /></Field>
          <Field label="Cuisine / kind"><Input value={f.cuisine} onChange={(e) => set({ cuisine: e.target.value })} placeholder="Armenian, Café, Wine bar…" className="h-10 rounded-none" /></Field>
          <Field label="City"><Input value={f.city} onChange={(e) => set({ city: e.target.value })} className="h-10 rounded-none" /></Field>
          <Field label="Region"><Input value={f.region} onChange={(e) => set({ region: e.target.value })} className="h-10 rounded-none" /></Field>
          <Field label="Neighborhood"><Input value={f.neighborhood} onChange={(e) => set({ neighborhood: e.target.value })} placeholder="e.g. City Center" className="h-10 rounded-none" /></Field>
          <Field label="Price band">
            <select value={f.priceBand} onChange={(e) => set({ priceBand: e.target.value as typeof f.priceBand })} className="h-10 w-full rounded-none border border-basalt/20 bg-paper px-2 text-sm">
              <option value="">—</option>
              <option value="$">$ · budget</option>
              <option value="$$">$$ · mid</option>
              <option value="$$$">$$$ · high-end</option>
            </select>
          </Field>
          <Field label="Photo URL"><Input value={f.image} onChange={(e) => set({ image: e.target.value })} placeholder="https://…" className="h-10 rounded-none" /></Field>
          <Field label="Website"><Input value={f.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://…" className="h-10 rounded-none" /></Field>
          <div className="sm:col-span-2"><Field label="Short description"><Textarea rows={2} value={f.shortDescription} onChange={(e) => set({ shortDescription: e.target.value })} className="rounded-none text-base" /></Field></div>
        </div>

        <div className="flex items-center gap-3 border-t border-basalt/10 pt-4">
          <Button onClick={save} disabled={saving} className="rounded-none bg-apricot font-semibold text-white hover:bg-apricot/90">{saving ? "Saving…" : "Add to guide"}</Button>
          {typeof f.googleRating === "number" && <span className="inline-flex items-center gap-1 text-xs text-basalt/55"><Star className="h-3.5 w-3.5 fill-apricot text-apricot" />{f.googleRating.toFixed(1)} ({f.googleRatingCount}) from Google</span>}
        </div>
      </div>

      <div className="mt-8">
        <p className="text-sm font-bold uppercase tracking-[0.1em] text-basalt/50">In the guide</p>
        {rows === null ? (
          <div className="grid place-items-center py-10 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-basalt/50">No restaurants yet — add your first above.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-basalt/12 bg-paper px-4 py-3">
                <Utensils className="h-4 w-4 shrink-0 text-basalt/40" />
                <span className="min-w-0 flex-1 truncate font-semibold text-basalt">{r.title}</span>
                {r.cuisine && <span className="text-xs text-basalt/50">{r.cuisine}</span>}
                {r.price_band && <span className="text-xs font-bold text-basalt/60">{r.price_band}</span>}
                {typeof r.google_rating === "number" && <span className="inline-flex items-center gap-0.5 text-xs text-basalt/50"><Star className="h-3 w-3 fill-apricot text-apricot" />{r.google_rating.toFixed(1)}</span>}
                <span className="text-[10px] font-bold uppercase tracking-wide text-basalt/35">{r.neighborhood || r.city}</span>
                <button type="button" onClick={() => remove(r.id, r.title)} className="shrink-0 text-basalt/40 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-semibold text-basalt/60">{label}</Label>
      {children}
    </div>
  );
}
