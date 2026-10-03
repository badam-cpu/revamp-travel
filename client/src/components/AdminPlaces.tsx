/**
 * Admin — curate venue recommendations (the free "Visit" guide): museums,
 * galleries, libraries, coworking spaces, and more. Mirrors AdminEateries but
 * for `type: "place"` rows, keyed by a `category` (PLACE_CATEGORIES) instead of
 * cuisine/price band. Search a place on Google to pre-fill name, rating,
 * address, website and summary; set the category + neighborhood and save.
 * Operators can't create these — only admins, via the "admins manage listings"
 * RLS policy (0051). Requires migration 0084 (type='place' + category column).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { adminPlaceDetails, adminTripadvisorMatch, ApiError } from "@/lib/api";
import { slugify } from "@/lib/slug";
import { PLACE_CATEGORIES, placeCategoryLabel } from "@shared/listings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Landmark, Star, Trash2 } from "lucide-react";
import { GooglePlaceFinder } from "@/components/GooglePlaceFinder";
import { PhotoUploader, type PhotoUploaderHandle } from "@/components/PhotoUploader";

interface PlaceRow {
  id: string;
  title: string;
  slug: string;
  category: string | null;
  city: string | null;
  neighborhood: string | null;
  google_rating: number | null;
  google_rating_count: number | null;
  status: string;
}

const BLANK = {
  placeId: "", title: "", category: "museum", city: "", region: "Yerevan", neighborhood: "",
  image: "", website: "", shortDescription: "", longDescription: "", address: "",
  googleRating: null as number | null, googleRatingCount: null as number | null,
  lat: null as number | null, lng: null as number | null,
  tripadvisorLocationId: "", tripadvisorRating: null as number | null, tripadvisorRatingCount: null as number | null,
  tripadvisorUrl: "", tripadvisorRatingImage: "",
  featured: false, editorRank: "" as string,
};

export function AdminPlaces() {
  const { user } = useAuth();
  const [rows, setRows] = useState<PlaceRow[] | null>(null);
  const [f, setF] = useState({ ...BLANK });
  const [enriching, setEnriching] = useState(false);
  const [taMatching, setTaMatching] = useState(false);
  const [saving, setSaving] = useState(false);
  const photosRef = useRef<PhotoUploaderHandle>(null);
  const [uploaderKey, setUploaderKey] = useState(0);
  const [galleryDefault, setGalleryDefault] = useState<string[]>([]);
  const [focusDefault, setFocusDefault] = useState("50% 50%");
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("listings")
      .select("id, title, slug, category, city, neighborhood, google_rating, google_rating_count, status")
      .eq("type", "place")
      .order("title");
    setRows((data ?? []) as PlaceRow[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (patch: Partial<typeof BLANK>) => setF((prev) => ({ ...prev, ...patch }));

  const onFound = async (r: { id: string; name: string }) => {
    set({ title: r.name, placeId: r.id });
    setEnriching(true);
    try {
      const d = await adminPlaceDetails(r.id);
      set({
        placeId: d.placeId,
        title: d.name || r.name,
        address: d.address ?? "",
        website: d.website ?? "",
        googleRating: d.rating,
        googleRatingCount: d.ratingCount,
        lat: d.lat,
        lng: d.lng,
        shortDescription: d.summary ?? "",
      });
      toast(`Pulled "${d.name}" from Google — set the category and neighborhood, then save.`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't fetch that place. Fill the details in manually and save.");
    } finally {
      setEnriching(false);
    }
  };

  const matchTa = async () => {
    if (!f.title.trim()) {
      toast("Add the place name first.");
      return;
    }
    setTaMatching(true);
    try {
      const m = await adminTripadvisorMatch(f.title.trim(), f.city.trim() || f.region.trim());
      set({
        tripadvisorLocationId: m.locationId,
        tripadvisorRating: m.rating,
        tripadvisorRatingCount: m.ratingCount,
        tripadvisorUrl: m.url ?? "",
        tripadvisorRatingImage: m.ratingImage ?? "",
      });
      toast(m.rating != null ? `Matched "${m.name}" on Tripadvisor — ${m.rating} (${m.ratingCount}).` : `Matched "${m.name}" on Tripadvisor.`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't match on Tripadvisor.");
    } finally {
      setTaMatching(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setF({ ...BLANK });
    setGalleryDefault([]);
    setFocusDefault("50% 50%");
    setUploaderKey((k) => k + 1);
  };

  const startEdit = async (id: string) => {
    const { data, error } = await supabase.from("listings").select("*").eq("id", id).maybeSingle();
    if (error || !data) {
      toast("Couldn't load that place.");
      return;
    }
    setEditingId(id);
    setF({
      placeId: data.google_place_id ?? "",
      title: data.title ?? "",
      category: data.category ?? "museum",
      city: data.city ?? "",
      region: data.region ?? "Yerevan",
      neighborhood: data.neighborhood ?? "",
      image: data.image ?? "",
      website: data.website ?? "",
      shortDescription: data.short_description ?? "",
      longDescription: data.long_description ?? "",
      address: data.address ?? "",
      googleRating: data.google_rating ?? null,
      googleRatingCount: data.google_rating_count ?? null,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      tripadvisorLocationId: data.tripadvisor_location_id ?? "",
      tripadvisorRating: data.tripadvisor_rating ?? null,
      tripadvisorRatingCount: data.tripadvisor_rating_count ?? null,
      tripadvisorUrl: data.tripadvisor_url ?? "",
      tripadvisorRatingImage: data.tripadvisor_rating_image ?? "",
      featured: !!data.featured,
      editorRank: data.editor_rank == null ? "" : String(data.editor_rank),
    });
    setGalleryDefault(Array.isArray(data.gallery) && data.gallery.length ? data.gallery : data.image ? [data.image] : []);
    setFocusDefault(data.cover_focus ?? "50% 50%");
    setUploaderKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (!user) return;
    const photos = photosRef.current?.getValue() ?? [];
    if (!f.title.trim() || !f.city.trim() || photos.length === 0) {
      toast("Add at least a name, city, and one photo.");
      return;
    }
    const category = f.category.trim().toLowerCase();
    const cover = photos[0];
    setSaving(true);
    try {
      const payload = {
        title: f.title.trim(),
        eyebrow: placeCategoryLabel(category),
        city: f.city.trim(),
        region: f.region.trim() || "Yerevan",
        address: f.address.trim() || null,
        lat: f.lat ?? 0,
        lng: f.lng ?? 0,
        image: cover,
        gallery: photos,
        cover_focus: photosRef.current?.getCoverFocus() ?? "50% 50%",
        short_description: f.shortDescription.trim() || `A Revamp-recommended spot in ${f.city.trim()}.`,
        long_description: f.longDescription.trim(),
        tags: [placeCategoryLabel(category)].filter(Boolean),
        category: category || null,
        website: f.website.trim() || null,
        google_place_id: f.placeId || null,
        google_rating: f.googleRating,
        google_rating_count: f.googleRatingCount,
        tripadvisor_location_id: f.tripadvisorLocationId || null,
        tripadvisor_rating: f.tripadvisorRating,
        tripadvisor_rating_count: f.tripadvisorRatingCount,
        tripadvisor_url: f.tripadvisorUrl || null,
        tripadvisor_rating_image: f.tripadvisorRatingImage || null,
        neighborhood: f.neighborhood.trim() || null,
        featured: f.featured,
        editor_rank: f.editorRank.trim() === "" ? null : Math.max(0, Math.round(Number(f.editorRank) || 0)),
      };
      if (editingId) {
        const { error } = await supabase.from("listings").update(payload).eq("id", editingId);
        if (error) throw new Error(error.message);
        toast("Place updated.");
      } else {
        const slug = `${slugify(f.title)}-${Math.random().toString(36).slice(2, 6)}`;
        const { error } = await supabase.from("listings").insert({
          ...payload,
          operator_id: user.id,
          type: "place",
          status: "published",
          slug,
          price_cents: 0,
          price_unit: "",
          amenities: [],
          facts: [],
          accent: "apricot",
        });
        if (error) throw new Error(error.message);
        toast("Place added to the guide.");
      }
      resetForm();
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
        <p className="eyebrow">Visit guide</p>
        <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">{editingId ? "Edit place." : "Places to visit."}</h2>
        <p className="mt-2 max-w-xl text-sm text-basalt/55">Free, curated venues — museums, galleries, libraries, coworking spaces and more. Search a place on Google to pull its rating, address and website, then pick a category and save.</p>
      </div>

      <div className="grid gap-3 border border-basalt/12 bg-paper p-5">
        <div>
          <Label className="mb-1.5 block text-xs font-semibold text-basalt/60">Find on Google</Label>
          <GooglePlaceFinder onFound={onFound} />
          {enriching && <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-basalt/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching details…</p>}
        </div>

        <div className="grid gap-3 border-t border-basalt/10 pt-4 sm:grid-cols-2">
          <Field label="Name"><Input value={f.title} onChange={(e) => set({ title: e.target.value })} className="h-10 rounded-none" /></Field>
          <Field label="Category">
            <select value={f.category} onChange={(e) => set({ category: e.target.value })} className="h-10 w-full rounded-none border border-basalt/20 bg-paper px-2 text-sm">
              {PLACE_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="City"><Input value={f.city} onChange={(e) => set({ city: e.target.value })} className="h-10 rounded-none" /></Field>
          <Field label="Region"><Input value={f.region} onChange={(e) => set({ region: e.target.value })} className="h-10 rounded-none" /></Field>
          <Field label="Neighborhood"><Input value={f.neighborhood} onChange={(e) => set({ neighborhood: e.target.value })} placeholder="e.g. City Center" className="h-10 rounded-none" /></Field>
          <Field label="Website"><Input value={f.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://…" className="h-10 rounded-none" /></Field>
          <Field label="Curation rank">
            <Input type="number" min={0} value={f.editorRank} onChange={(e) => set({ editorRank: e.target.value })} placeholder="e.g. 1 (lower = higher up)" className="h-10 rounded-none" />
          </Field>
          <Field label="Featured">
            <label className="flex h-10 items-center gap-2 text-sm text-basalt/70">
              <input type="checkbox" checked={f.featured} onChange={(e) => set({ featured: e.target.checked })} className="h-4 w-4 accent-apricot" />
              Pin to the top of the guide
            </label>
          </Field>
          <div className="sm:col-span-2"><Field label="Short description"><Textarea rows={2} value={f.shortDescription} onChange={(e) => set({ shortDescription: e.target.value })} placeholder="One-line teaser shown on the card and as the lead." className="rounded-none text-base" /></Field></div>
          <div className="sm:col-span-2"><Field label="Long description"><Textarea rows={4} value={f.longDescription} onChange={(e) => set({ longDescription: e.target.value })} placeholder="Fuller write-up shown on the place page (optional)." className="rounded-none text-base" /></Field></div>
          <div className="sm:col-span-2"><PhotoUploader key={uploaderKey} ref={photosRef} defaultValue={galleryDefault} defaultFocus={focusDefault} /></div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-basalt/10 pt-4">
          <Button onClick={save} disabled={saving} className="rounded-none bg-apricot font-semibold text-white hover:bg-apricot/90">{saving ? "Saving…" : editingId ? "Save changes" : "Add to guide"}</Button>
          {editingId && <button type="button" onClick={resetForm} className="text-sm font-semibold text-basalt/50 hover:text-apricot">Cancel</button>}
          <button type="button" onClick={matchTa} disabled={taMatching || !f.title.trim()} className="inline-flex items-center gap-1.5 border border-basalt/20 px-3 py-1.5 text-xs font-semibold text-basalt hover:border-apricot hover:text-apricot disabled:opacity-40">
            {taMatching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Match on Tripadvisor
          </button>
          <span className="flex items-center gap-3 text-xs text-basalt/55">
            {typeof f.googleRating === "number" && <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-apricot text-apricot" />{f.googleRating.toFixed(1)} ({f.googleRatingCount}) Google</span>}
            {typeof f.tripadvisorRating === "number" && <span className="inline-flex items-center gap-1">{f.tripadvisorRatingImage ? <img src={f.tripadvisorRatingImage} alt="Tripadvisor rating" className="h-3" /> : null}{f.tripadvisorRating.toFixed(1)} ({f.tripadvisorRatingCount}) Tripadvisor</span>}
          </span>
        </div>
      </div>

      <div className="mt-8">
        <p className="text-sm font-bold uppercase tracking-[0.1em] text-basalt/50">In the guide</p>
        {rows === null ? (
          <div className="grid place-items-center py-10 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-basalt/50">No places yet — add your first above.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-basalt/12 bg-paper px-4 py-3">
                <Landmark className="h-4 w-4 shrink-0 text-basalt/40" />
                <span className="min-w-0 flex-1 truncate font-semibold text-basalt">{r.title}</span>
                {r.category && <span className="text-xs font-semibold text-basalt/60">{placeCategoryLabel(r.category)}</span>}
                {typeof r.google_rating === "number" && <span className="inline-flex items-center gap-0.5 text-xs text-basalt/50"><Star className="h-3 w-3 fill-apricot text-apricot" />{r.google_rating.toFixed(1)}</span>}
                <span className="text-[10px] font-bold uppercase tracking-wide text-basalt/35">{r.neighborhood || r.city}</span>
                <button type="button" onClick={() => startEdit(r.id)} className="shrink-0 text-xs font-semibold text-basalt/60 hover:text-apricot">Edit</button>
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
