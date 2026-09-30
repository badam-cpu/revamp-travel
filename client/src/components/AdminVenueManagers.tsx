/**
 * Admin control to grant a restaurant its owner dashboard (/venue). Links a
 * signed-up account (by email) to an 'eat' listing via restaurant_managers
 * (migration 0078) through POST /api/admin-link-venue. The owner then sees that
 * venue's analytics + voucher performance at /venue. Read-only grant — it does
 * not let them edit the (house-owned) listing.
 */
import { useMemo, useState } from "react";
import { useListings } from "@/contexts/ListingsContext";
import { adminLinkVenue, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function AdminVenueManagers() {
  const { listings } = useListings();
  const eats = useMemo(() => listings.filter((l) => l.type === "eat").sort((a, b) => a.title.localeCompare(b.title)), [listings]);
  const [listingId, setListingId] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"link" | "unlink" | null>(null);

  const act = async (action: "link" | "unlink") => {
    if (!listingId) return toast("Pick a restaurant.");
    if (!email.trim()) return toast("Enter the owner's account email.");
    setBusy(action);
    try {
      const r = await adminLinkVenue(email.trim(), listingId, action);
      toast.success(r.linked ? "Linked — they can now open /venue." : "Unlinked.");
      if (action === "link") setEmail("");
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't update that link.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border border-basalt/12 bg-paper p-5">
      <h3 className="font-display text-xl font-normal text-basalt">Venue owner access</h3>
      <p className="mt-1 max-w-2xl text-sm text-basalt/55">Give a restaurant's owner a read-only dashboard (<code className="text-basalt/70">/venue</code>) of their listing's analytics + voucher performance. They must have signed up for a Revamp account first; this doesn't let them edit the listing.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold">Restaurant</Label>
          <select value={listingId} onChange={(e) => setListingId(e.target.value)} className="h-10 rounded-none border border-basalt/15 bg-paper px-3 text-sm">
            <option value="">Choose a restaurant…</option>
            {eats.map((l) => <option key={l.id} value={l.id}>{l.title} · {l.city}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold">Owner account email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com" className="h-10 rounded-none" />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => act("link")} disabled={busy !== null} className="h-10 rounded-none bg-apricot text-white hover:bg-apricot/90">{busy === "link" ? "…" : "Link"}</Button>
          <Button variant="outline" onClick={() => act("unlink")} disabled={busy !== null} className="h-10 rounded-none border-basalt/20">{busy === "unlink" ? "…" : "Unlink"}</Button>
        </div>
      </div>
    </div>
  );
}
