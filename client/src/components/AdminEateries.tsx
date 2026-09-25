/**
 * Admin — curate restaurant recommendations (the free "Eat" guide). Admins add a
 * spot by searching Google (Places API New), which pre-fills name, rating,
 * address, website and price band; the admin sets cuisine + neighborhood and
 * saves it as a type='eat' listing (owned by the admin, published, price 0).
 * Operators can't create these — only admins, via the RLS policy in 0051.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { adminPlaceDetails, adminTripadvisorMatch, ApiError } from "@/lib/api";
import { slugify } from "@/lib/slug";
import { EAT_CATEGORIES, VENUE_TYPES } from "@/lib/eatCategories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Star, Trash2, Utensils } from "lucide-react";
import { GooglePlaceFinder } from "@/components/GooglePlaceFinder";
import { PhotoUploader, type PhotoUploaderHandle } from "@/components/PhotoUploader";

interface EatRow {
  id: string;
  title: string;
  slug: string;
  venue_type: string | null;
  cuisine: string | null;
  price_band: string | null;
  city: string | null;
  neighborhood: string | null;
  google_rating: number | null;
  google_rating_count: number | null;
  status: string;
}

const BLANK = {
  placeId: "", title: "", venueType: "", cuisine: "", priceBand: "" as "" | "$" | "$$" | "$$$",
  city: "", region: "Yerevan", neighborhood: "", image: "", website: "",
  shortDescription: "", longDescription: "", address: "", googleRating: null as number | null, googleRatingCount: null as number | null,
  lat: null as number | null, lng: null as number | null,
  tripadvisorLocationId: "", tripadvisorRating: null as number | null, tripadvisorRatingCount: null as number | null,
  tripadvisorUrl: "", tripadvisorRatingImage: "", tripadvisorMenuUrl: "",
  featured: false, editorRank: "" as string,
  branches: [] as { label: string; address: string; coords: string }[],
};

export function AdminEateries() {
  const { user } = useAuth();
  const [rows, setRows] = useState<EatRow[] | null>(null);
  const [f, setF] = useState({ ...BLANK });
  const [enriching, setEnriching] = useState(false);
  const [taMatching, setTaMatching] = useState(false);
  const [saving, setSaving] = useState(false);
  const photosRef = useRef<PhotoUploaderHandle>(null);
  const [uploaderKey, setUploaderKey] = useState(0); // bump to reset/reseed the uploader
  const [galleryDefault, setGalleryDefault] = useState<string[]>([]);
  const [focusDefault, setFocusDefault] = useState("50% 50%");
  const [formKey, setFormKey] = useState(0); // remounts the category selects on edit/reset
  const [editingId, setEditingId] = useState<string | null>(null);

  // Options = curated lists ∪ values already used, so admin-added ones persist.
  const venueOptions = Array.from(new Set([...VENUE_TYPES, ...(rows ?? []).map((r) => r.venue_type).filter((c): c is string => !!c)]));
  const cuisineOptions = Array.from(new Set([...EAT_CATEGORIES, ...(rows ?? []).map((r) => r.cuisine).filter((c): c is string => !!c)])).sort();

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("listings")
      .select("id, title, slug, venue_type, cuisine, price_band, city, neighborhood, google_rating, google_rating_count, status")
      .eq("type", "eat")
      .order("title");
    setRows((data ?? []) as EatRow[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (patch: Partial<typeof BLANK>) => setF((prev) => ({ ...prev, ...patch }));

  // Branch helpers (functional updates so they're safe across async Google calls).
  type BranchRow = { label: string; address: string; coords: string };
  const setBranch = (i: number, patch: Partial<BranchRow>) =>
    setF((prev) => ({ ...prev, branches: prev.branches.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const addBranch = () => setF((prev) => ({ ...prev, branches: [...prev.branches, { label: "", address: "", coords: "" }] }));
  const removeBranch = (i: number) => setF((prev) => ({ ...prev, branches: prev.branches.filter((_, j) => j !== i) }));
  const [branchBusy, setBranchBusy] = useState<number | null>(null);
  /** Pull a branch's address + coordinates from the Google place the admin picked. */
  const pullBranch = async (i: number, r: { id: string; name: string }) => {
    setBranch(i, { label: r.name }); // instant name; details fill in next
    setBranchBusy(i);
    try {
      const d = await adminPlaceDetails(r.id);
      setBranch(i, {
        label: r.name || d.name || "",
        address: d.address ?? "",
        coords: d.lat != null && d.lng != null ? `${d.lat}, ${d.lng}` : "",
      });
      toast(`Pulled "${d.name}" from Google.`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't fetch that branch — enter its coordinates manually.");
    } finally {
      setBranchBusy(null);
    }
  };

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
        venueType: d.venueType ?? "",
        googleRating: d.rating,
        googleRatingCount: d.ratingCount,
        lat: d.lat,
        lng: d.lng,
        shortDescription: d.summary ?? "",
      });
      setFormKey((k) => k + 1); // reseed the type/cuisine selects with the pulled values
      toast(`Pulled "${d.name}" from Google — set the type, cuisine and neighborhood, then save.`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't fetch that place. Fill the details in manually and save.");
    } finally {
      setEnriching(false);
    }
  };

  const matchTa = async () => {
    if (!f.title.trim()) {
      toast("Add the restaurant name first.");
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
        tripadvisorMenuUrl: m.menuUrl ?? "",
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
    setFormKey((k) => k + 1);
  };

  const startEdit = async (id: string) => {
    const { data, error } = await supabase.from("listings").select("*").eq("id", id).maybeSingle();
    if (error || !data) {
      toast("Couldn't load that restaurant.");
      return;
    }
    setEditingId(id);
    setF({
      placeId: data.google_place_id ?? "",
      title: data.title ?? "",
      venueType: data.venue_type ?? "",
      cuisine: data.cuisine ?? "",
      priceBand: (data.price_band ?? "") as "" | "$" | "$$" | "$$$",
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
      tripadvisorMenuUrl: data.tripadvisor_menu_url ?? "",
      featured: !!data.featured,
      editorRank: data.editor_rank == null ? "" : String(data.editor_rank),
      branches: Array.isArray(data.branches)
        ? (data.branches as { label?: string; address?: string; lat?: number; lng?: number }[]).map((b) => ({ label: b.label ?? "", address: b.address ?? "", coords: b.lat != null && b.lng != null ? `${b.lat}, ${b.lng}` : "" }))
        : [],
    });
    setGalleryDefault(Array.isArray(data.gallery) && data.gallery.length ? data.gallery : data.image ? [data.image] : []);
    setFocusDefault(data.cover_focus ?? "50% 50%");
    setUploaderKey((k) => k + 1); // remount uploader seeded with the existing photos
    setFormKey((k) => k + 1); // reseed the type/cuisine selects
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (!user) return;
    const photos = photosRef.current?.getValue() ?? [];
    if (!f.title.trim() || !f.city.trim() || photos.length === 0) {
      toast("Add at least a name, city, and one photo.");
      return;
    }
    const cover = photos[0];
    setSaving(true);
    try {
      // Fields common to create + edit.
      const payload = {
        title: f.title.trim(),
        eyebrow: f.venueType.trim() || f.cuisine.trim() || "Restaurant",
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
        tags: [f.venueType.trim(), f.cuisine.trim()].filter(Boolean),
        venue_type: f.venueType.trim() || null,
        cuisine: f.cuisine.trim() || null,
        price_band: f.priceBand || null,
        website: f.website.trim() || null,
        google_place_id: f.placeId || null,
        google_rating: f.googleRating,
        google_rating_count: f.googleRatingCount,
        tripadvisor_location_id: f.tripadvisorLocationId || null,
        tripadvisor_rating: f.tripadvisorRating,
        tripadvisor_rating_count: f.tripadvisorRatingCount,
        tripadvisor_url: f.tripadvisorUrl || null,
        tripadvisor_rating_image: f.tripadvisorRatingImage || null,
        tripadvisor_menu_url: f.tripadvisorMenuUrl || null,
        neighborhood: f.neighborhood.trim() || null,
        featured: f.featured,
        editor_rank: f.editorRank.trim() === "" ? null : Math.max(0, Math.round(Number(f.editorRank) || 0)),
        branches: f.branches
          .map((b) => {
            const [latS, lngS] = b.coords.split(",").map((s) => s.trim());
            const lat = Number(latS);
            const lng = Number(lngS);
            return { label: b.label.trim(), address: b.address.trim(), lat, lng };
          })
          .filter((b) => (b.address || b.label) && Number.isFinite(b.lat) && Number.isFinite(b.lng)),
      };
      if (editingId) {
        const { error } = await supabase.from("listings").update(payload).eq("id", editingId);
        if (error) throw new Error(error.message);
        toast("Restaurant updated.");
      } else {
        const slug = `${slugify(f.title)}-${Math.random().toString(36).slice(2, 6)}`;
        const { error } = await supabase.from("listings").insert({
          ...payload,
          operator_id: user.id,
          type: "eat",
          status: "published",
          slug,
          price_cents: 0,
          price_unit: "",
          amenities: [],
          facts: [],
          accent: "apricot",
        });
        if (error) throw new Error(error.message);
        toast("Restaurant added to the guide.");
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
        <p className="eyebrow">Eat guide</p>
        <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">{editingId ? "Edit restaurant." : "Restaurant recommendations."}</h2>
        <p className="mt-2 max-w-xl text-sm text-basalt/55">Free, curated picks — no bookings, no operator accounts. Search a place on Google to pull its rating, address and price band, then add a category and neighborhood.</p>
      </div>

      <div className="grid gap-3 border border-basalt/12 bg-paper p-5">
        <div>
          <Label className="mb-1.5 block text-xs font-semibold text-basalt/60">Find on Google</Label>
          <GooglePlaceFinder onFound={onFound} />
          {enriching && <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-basalt/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching details…</p>}
        </div>

        <div className="grid gap-3 border-t border-basalt/10 pt-4 sm:grid-cols-2">
          <Field label="Name"><Input value={f.title} onChange={(e) => set({ title: e.target.value })} className="h-10 rounded-none" /></Field>
          <Field label="Type"><CategorySelect key={`ven-${formKey}`} value={f.venueType} options={venueOptions} placeholder="Choose a type…" newLabel="+ Add new type…" onChange={(v) => set({ venueType: v })} /></Field>
          <Field label="Cuisine"><CategorySelect key={`cui-${formKey}`} value={f.cuisine} options={cuisineOptions} placeholder="Choose a cuisine…" newLabel="+ Add new cuisine…" onChange={(v) => set({ cuisine: v })} /></Field>
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
          <Field label="Website"><Input value={f.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://…" className="h-10 rounded-none" /></Field>
          <Field label="Curation rank">
            <Input type="number" min={0} value={f.editorRank} onChange={(e) => set({ editorRank: e.target.value })} placeholder="e.g. 1 (lower = higher up)" className="h-10 rounded-none" />
          </Field>
          <Field label="Featured">
            <label className="flex h-10 items-center gap-2 text-sm text-basalt/70">
              <input type="checkbox" checked={f.featured} onChange={(e) => set({ featured: e.target.checked })} className="h-4 w-4 accent-apricot" />
              Pin to the top of the guide &amp; area/cuisine pages
            </label>
          </Field>
          <div className="sm:col-span-2"><Field label="Short description"><Textarea rows={2} value={f.shortDescription} onChange={(e) => set({ shortDescription: e.target.value })} placeholder="One-line teaser shown on the card and as the lead." className="rounded-none text-base" /></Field></div>
          <div className="sm:col-span-2"><Field label="Long description"><Textarea rows={4} value={f.longDescription} onChange={(e) => set({ longDescription: e.target.value })} placeholder="Fuller write-up shown on the restaurant page (optional)." className="rounded-none text-base" /></Field></div>
          <div className="sm:col-span-2">
            <Field label="Other locations (branches)">
              <div className="grid gap-3">
                {f.branches.map((b, i) => (
                  <div key={i} className="grid gap-2 border border-basalt/12 bg-chalk/40 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">{b.label ? b.label : `Branch ${i + 1}`}{branchBusy === i ? " · pulling…" : ""}</span>
                      <button type="button" onClick={() => removeBranch(i)} className="text-xs font-semibold text-basalt/45 hover:text-destructive">Remove</button>
                    </div>
                    <GooglePlaceFinder onFound={(r) => pullBranch(i, r)} />
                    {(b.address || b.coords) && <p className="text-xs text-basalt/55">{b.address}{b.coords ? ` · ${b.coords}` : ""}</p>}
                    {/* Manual fallback if a branch isn't on Google / the pull fails. */}
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                      <Input placeholder="Label (e.g. Northern Ave)" value={b.label} onChange={(e) => setBranch(i, { label: e.target.value })} className="h-9 rounded-none" />
                      <Input placeholder="lat, lng" value={b.coords} onChange={(e) => setBranch(i, { coords: e.target.value })} className="h-9 rounded-none" />
                    </div>
                  </div>
                ))}
                <button type="button" onClick={addBranch} className="justify-self-start text-sm font-semibold text-apricot hover:underline">+ Add a branch</button>
              </div>
              <p className="mt-1 text-xs text-basalt/45">For chains. Search each location on Google to pull its address + coordinates automatically; edit the label if you like. One card in the guide; every branch shows on the listing page and its map.</p>
            </Field>
          </div>
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
          <p className="mt-3 text-sm text-basalt/50">No restaurants yet — add your first above.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-basalt/12 bg-paper px-4 py-3">
                <Utensils className="h-4 w-4 shrink-0 text-basalt/40" />
                <span className="min-w-0 flex-1 truncate font-semibold text-basalt">{r.title}</span>
                {r.venue_type && <span className="text-xs font-semibold text-basalt/60">{r.venue_type}</span>}
                {r.cuisine && <span className="text-xs text-basalt/50">{r.cuisine}</span>}
                {r.price_band && <span className="text-xs font-bold text-basalt/60">{r.price_band}</span>}
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

/** A picker from a curated list with an inline "add new" free-text fallback.
 *  Remount (via key) to reseed from a new `value`. */
function CategorySelect({ value, options, placeholder, newLabel, onChange }: { value: string; options: string[]; placeholder: string; newLabel: string; onChange: (v: string) => void }) {
  const [custom, setCustom] = useState(!!value && !options.includes(value));
  if (custom) {
    return (
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Type a new one" className="h-10 rounded-none" autoFocus />
        <button type="button" onClick={() => { setCustom(false); onChange(""); }} className="shrink-0 text-xs font-semibold text-basalt/50 hover:text-apricot">List</button>
      </div>
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => { if (e.target.value === "__other__") { setCustom(true); onChange(""); } else onChange(e.target.value); }}
      className="h-10 w-full rounded-none border border-basalt/20 bg-paper px-2 text-sm"
    >
      <option value="">{placeholder}</option>
      {options.map((c) => <option key={c} value={c}>{c}</option>)}
      <option value="__other__">{newLabel}</option>
    </select>
  );
}
