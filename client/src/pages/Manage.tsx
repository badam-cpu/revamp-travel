/** Revamp brandbook: manage uses the same white/orange/charcoal surfaces and rounded geometry as the rest of the marketplace. */
import { FormEvent, useState } from "react";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useListings } from "@/contexts/ListingsContext";
import type { Listing, ListingInput, ListingType } from "@shared/listings";
import { ApiError } from "@/lib/api";
import { toast } from "sonner";

type DraftListing = Partial<Listing> & { type: ListingType };

function emptyDraft(type: ListingType): DraftListing {
  return {
    type,
    title: "",
    eyebrow: "",
    city: "",
    region: "",
    coordinates: { lat: 40.18, lng: 44.51 },
    shortDescription: "",
    longDescription: "",
    price: 0,
    tags: [],
    facts: [],
    amenities: [],
    accent: type === "tour" ? "apricot" : "sevan",
    image: "",
  };
}

function toInputPayload(draft: DraftListing, form: HTMLFormElement): ListingInput {
  const get = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
  const price = Number(get("price")) || 0;
  const tags = get("tags").split(",").map((t) => t.trim()).filter(Boolean);
  const amenities = get("amenities").split(",").map((t) => t.trim()).filter(Boolean);
  const facts = [1, 2, 3]
    .map((n) => ({ label: get(`fact${n}Label`).trim(), value: get(`fact${n}Value`).trim() }))
    .filter((f) => f.label && f.value);

  return {
    type: draft.type,
    title: get("title").trim(),
    eyebrow: get("eyebrow").trim(),
    city: get("city").trim(),
    region: get("region").trim(),
    coordinates: { lat: Number(get("lat")) || 0, lng: Number(get("lng")) || 0 },
    image: get("image").trim() || undefined,
    shortDescription: get("shortDescription").trim(),
    longDescription: get("longDescription").trim(),
    price,
    priceLabel: `$${price}`,
    priceUnit: get("priceUnit").trim() || (draft.type === "stay" ? "night" : "person"),
    tags,
    facts,
    amenities,
    featured: (form.elements.namedItem("featured") as HTMLInputElement | null)?.checked || false,
    accent: (get("accent") as ListingInput["accent"]) || "apricot",
  };
}

function ListingFormDialog({
  draft,
  open,
  onOpenChange,
  onSaved,
}: {
  draft: DraftListing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { createListing, updateListing } = useListings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!draft) return null;
  const isEdit = Boolean(draft.id);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = toInputPayload(draft, event.currentTarget);
      if (isEdit && draft.id) {
        await updateListing(draft.id, payload);
        toast(`${payload.title} updated.`);
      } else {
        await createListing(payload);
        toast(`${payload.title} added to the catalog.`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save this listing. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{isEdit ? `Edit ${draft.title}` : `Add a ${draft.type}`}</DialogTitle>
          <DialogDescription>Saved to the shared catalog immediately — every page (cards, map, search) picks it up right away.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="title">Title</Label><Input id="title" name="title" defaultValue={draft.title} required /></div>
            <div className="grid gap-1.5"><Label htmlFor="eyebrow">Eyebrow label</Label><Input id="eyebrow" name="eyebrow" placeholder="e.g. Timber hideaway" defaultValue={draft.eyebrow} required /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="city">City</Label><Input id="city" name="city" defaultValue={draft.city} required /></div>
            <div className="grid gap-1.5"><Label htmlFor="region">Region</Label><Input id="region" name="region" defaultValue={draft.region} required /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="lat">Latitude</Label><Input id="lat" name="lat" type="number" step="0.0001" min={38} max={42} defaultValue={draft.coordinates?.lat} required /></div>
            <div className="grid gap-1.5"><Label htmlFor="lng">Longitude</Label><Input id="lng" name="lng" type="number" step="0.0001" min={43} max={47} defaultValue={draft.coordinates?.lng} required /></div>
          </div>
          <p className="-mt-2 text-xs text-basalt/45">Coordinates must fall inside Armenia (lat 38–42, lng 43–47) — used to place the pin on the atlas.</p>

          <div className="grid gap-1.5"><Label htmlFor="shortDescription">Short description</Label><Textarea id="shortDescription" name="shortDescription" rows={2} defaultValue={draft.shortDescription} required /></div>
          <div className="grid gap-1.5"><Label htmlFor="longDescription">Full description</Label><Textarea id="longDescription" name="longDescription" rows={4} defaultValue={draft.longDescription} required /></div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label htmlFor="price">Price ({draft.type === "stay" ? "per night" : "per person"})</Label><Input id="price" name="price" type="number" min={0} defaultValue={draft.price} required /></div>
            <div className="grid gap-1.5"><Label htmlFor="priceUnit">Price unit label</Label><Input id="priceUnit" name="priceUnit" placeholder={draft.type === "stay" ? "night" : "person"} defaultValue={draft.priceUnit} /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="accent">Marker color</Label>
              <Select name="accent" defaultValue={draft.accent}>
                <SelectTrigger id="accent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="apricot">Apricot</SelectItem>
                  <SelectItem value="sevan">Charcoal</SelectItem>
                  <SelectItem value="tuff">Tuff</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5"><Label htmlFor="tags">Tags (comma separated)</Label><Input id="tags" name="tags" placeholder="Forest, Breakfast, Design stay" defaultValue={draft.tags?.join(", ")} /></div>
          <div className="grid gap-1.5"><Label htmlFor="amenities">Amenities (comma separated)</Label><Input id="amenities" name="amenities" placeholder="Wi-Fi, Breakfast basket, Local transfers" defaultValue={draft.amenities?.join(", ")} /></div>

          <div>
            <Label className="mb-2 block">Quick facts (up to 3, optional)</Label>
            <div className="grid gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <Input name={`fact${i + 1}Label`} placeholder="Label, e.g. Sleeps" defaultValue={draft.facts?.[i]?.label} />
                  <Input name={`fact${i + 1}Value`} placeholder="Value, e.g. 2 guests" defaultValue={draft.facts?.[i]?.value} />
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-1.5"><Label htmlFor="image">Image URL (optional)</Label><Input id="image" name="image" placeholder="Leave blank to use a brand illustration" defaultValue={draft.image} /></div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="featured" defaultChecked={draft.featured} className="h-4 w-4 accent-[#F15822]" />
            Feature on the home page
          </label>

          {error && (
            <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" className="rounded-none bg-apricot text-white hover:bg-apricot/90" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add listing"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManageSection({ type, title, description }: { type: ListingType; title: string; description: string }) {
  const { listings, deleteListing } = useListings();
  const items = listings.filter((l) => l.type === type);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<DraftListing | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const openAdd = () => { setDraft(emptyDraft(type)); setDialogOpen(true); };
  const openEdit = (listing: Listing) => { setDraft(listing); setDialogOpen(true); };

  const confirmDelete = async (listing: Listing) => {
    if (!window.confirm(`Remove "${listing.title}" from the catalog? This can't be undone.`)) return;
    setDeletingId(listing.id);
    try {
      await deleteListing(listing.id);
      toast(`${listing.title} removed.`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't delete this listing.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="border-t border-basalt/10 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{title}</p>
          <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">{items.length} listed</h2>
          <p className="mt-2 max-w-md text-sm text-basalt/55">{description}</p>
        </div>
        <Button onClick={openAdd} className="rounded-none bg-apricot text-white hover:bg-apricot/90">
          <Plus className="mr-2 h-4 w-4" /> Add {type}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="mt-8 border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">Nothing here yet — add the first one above.</p>
      ) : (
        <div className="mt-8 grid gap-3">
          {items.map((listing) => (
            <div key={listing.id} className="flex flex-wrap items-center justify-between gap-4 border border-basalt/10 bg-paper p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-xl leading-tight">{listing.title}</p>
                <p className="mt-1 text-xs text-basalt/50">{listing.city}, {listing.region} · {listing.priceLabel} / {listing.priceUnit}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="rounded-none border-basalt/15" onClick={() => openEdit(listing)}><Pencil className="mr-2 h-3.5 w-3.5" /> Edit</Button>
                <Button variant="outline" size="sm" className="rounded-none border-destructive/30 text-destructive hover:bg-destructive/5" disabled={deletingId === listing.id} onClick={() => confirmDelete(listing)}>
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> {deletingId === listing.id ? "Removing…" : "Delete"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ListingFormDialog draft={draft} open={dialogOpen} onOpenChange={setDialogOpen} onSaved={() => setDialogOpen(false)} />
    </section>
  );
}

export default function Manage() {
  const { offline } = useListings();

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-12 lg:py-16">
        <p className="eyebrow">Inventory</p>
        <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl">Manage stays &amp; tours.</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-basalt/60">
          Add, edit, or remove the stays and tours shown across the marketplace. Restaurants stay editorial and aren't managed here.
          Changes save to the shared catalog immediately for everyone browsing the site.
        </p>
        {offline && (
          <div className="mt-6 flex items-start gap-2 border border-tuff/40 bg-tuff/10 p-4 text-sm text-basalt">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tuff" />
            Can't reach the catalog API right now — showing the built-in sample listings read-only. Adding, editing, and deleting will resume once the server is reachable.
          </div>
        )}

        <ManageSection type="stay" title="Stays" description="Guesthouses, cabins, and small hotels shown on /explore/stay and the home page." />
        <ManageSection type="tour" title="Tours" description="Guided routes and experiences shown on /explore/tour and the home page." />
      </main>
      <SiteFooter />
    </div>
  );
}
