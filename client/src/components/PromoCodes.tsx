/**
 * Operator dashboard — create & manage promo codes for their own bookable
 * listings. Writes straight to Supabase under the operator-manages-own RLS
 * policy (migration 0070). Codes are validated + applied server-side at checkout.
 */
import { useEffect, useMemo, useState } from "react";
import { Trash2, Plus, Pencil, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { promoBadgeText } from "@shared/promo";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PromoRow {
  id: string;
  listing_id: string | null;
  code: string;
  discount_type: "percent" | "amount";
  discount_value: number;
  code_starts_at: string | null;
  code_ends_at: string | null;
  travel_start: string | null;
  travel_end: string | null;
  allowed_days: number[];
  min_stay_nights: number | null;
  max_redemptions: number | null;
  per_user_limit: number | null;
  active: boolean;
  show_on_listing: boolean;
  tag_label: string | null;
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface FormState {
  code: string;
  listing_id: string; // "" = all
  discount_type: "percent" | "amount";
  discount_value: string; // percent, or AMD whole for amount
  code_starts_at: string;
  code_ends_at: string;
  travel_start: string;
  travel_end: string;
  allowed_days: number[];
  min_stay_nights: string;
  max_redemptions: string;
  per_user_limit: string;
  active: boolean;
  show_on_listing: boolean;
  tag_label: string;
}

const BLANK: FormState = {
  code: "", listing_id: "", discount_type: "percent", discount_value: "", code_starts_at: "", code_ends_at: "",
  travel_start: "", travel_end: "", allowed_days: [], min_stay_nights: "", max_redemptions: "", per_user_limit: "",
  active: true, show_on_listing: false, tag_label: "",
};

export function PromoCodes() {
  const { user } = useAuth();
  const { listings } = useListings();
  const { format } = useCurrency();
  const [rows, setRows] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState<FormState>({ ...BLANK });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const myListings = useMemo(
    () => listings.filter((l) => (l as { operatorId?: string }).operatorId === user?.id && ["stay", "tour", "experience"].includes(l.type)),
    [listings, user?.id],
  );
  const listingTitle = (id: string | null) => (id ? myListings.find((l) => l.id === id)?.title ?? "A listing" : "All my listings");

  const load = () => {
    if (!user) return;
    setLoading(true);
    supabase
      .from("promo_codes")
      .select("*")
      .eq("operator_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setRows((data as PromoRow[]) ?? []);
        setLoading(false);
      });
  };
  useEffect(load, [user?.id]);

  const set = (patch: Partial<FormState>) => setF((p) => ({ ...p, ...patch }));
  const toggleDay = (d: number) => set({ allowed_days: f.allowed_days.includes(d) ? f.allowed_days.filter((x) => x !== d) : [...f.allowed_days, d].sort() });

  const reset = () => { setF({ ...BLANK }); setEditingId(null); };

  const edit = (r: PromoRow) => {
    setEditingId(r.id);
    setF({
      code: r.code,
      listing_id: r.listing_id ?? "",
      discount_type: r.discount_type,
      discount_value: r.discount_type === "amount" ? String(Math.round(r.discount_value / 100)) : String(r.discount_value),
      code_starts_at: r.code_starts_at ?? "",
      code_ends_at: r.code_ends_at ?? "",
      travel_start: r.travel_start ?? "",
      travel_end: r.travel_end ?? "",
      allowed_days: r.allowed_days ?? [],
      min_stay_nights: r.min_stay_nights != null ? String(r.min_stay_nights) : "",
      max_redemptions: r.max_redemptions != null ? String(r.max_redemptions) : "",
      per_user_limit: r.per_user_limit != null ? String(r.per_user_limit) : "",
      active: r.active,
      show_on_listing: r.show_on_listing,
      tag_label: r.tag_label ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (!user) return;
    const code = f.code.trim().toUpperCase();
    if (!code) return toast("Enter a code.");
    const value = Math.round(Number(f.discount_value) || 0);
    if (value <= 0) return toast("Enter a discount value.");
    if (f.discount_type === "percent" && value > 90) return toast("Percentage can't exceed 90.");
    const num = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.round(Number(s) || 0)));
    const payload = {
      operator_id: user.id,
      listing_id: f.listing_id || null,
      code,
      discount_type: f.discount_type,
      discount_value: f.discount_type === "amount" ? value * 100 : value,
      code_starts_at: f.code_starts_at || null,
      code_ends_at: f.code_ends_at || null,
      travel_start: f.travel_start || null,
      travel_end: f.travel_end || null,
      allowed_days: f.allowed_days,
      min_stay_nights: num(f.min_stay_nights),
      max_redemptions: num(f.max_redemptions),
      per_user_limit: num(f.per_user_limit),
      active: f.active,
      show_on_listing: f.show_on_listing,
      tag_label: f.tag_label.trim() || null,
      updated_at: new Date().toISOString(),
    };
    setSaving(true);
    const q = editingId
      ? supabase.from("promo_codes").update(payload).eq("id", editingId)
      : supabase.from("promo_codes").insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) return toast(error.message.includes("duplicate") ? "You already have a code with that name." : error.message);
    toast(editingId ? "Code updated." : "Code created.");
    reset();
    load();
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this promo code?")) return;
    const { error } = await supabase.from("promo_codes").delete().eq("id", id);
    if (error) return toast(error.message);
    load();
  };

  const toggleActive = async (r: PromoRow) => {
    const { error } = await supabase.from("promo_codes").update({ active: !r.active }).eq("id", r.id);
    if (error) return toast(error.message);
    load();
  };

  const field = "h-10 rounded-none";

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="font-display text-3xl font-normal text-basalt">Promo codes</h2>
        <p className="mt-1 max-w-2xl text-sm text-basalt/55">Create discount codes for your listings. Guests enter them at checkout; the discount is applied to the booking. Optionally show a code as a badge on the listing to advertise the deal.</p>
      </div>

      {/* Create / edit form */}
      <div className="grid gap-4 border border-basalt/12 bg-paper p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">{editingId ? "Edit code" : "New code"}</h3>
          {editingId && <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/50 hover:text-basalt"><X className="h-3.5 w-3.5" /> Cancel edit</button>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">Code</Label>
            <Input value={f.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="SUMMER10" className={cn(field, "uppercase")} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">Applies to</Label>
            <Select value={f.listing_id || "all"} onValueChange={(v) => set({ listing_id: v === "all" ? "" : v })}>
              <SelectTrigger className={field}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All my listings</SelectItem>
                {myListings.map((l) => <SelectItem key={l.id} value={l.id}>{l.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">Discount type</Label>
            <Select value={f.discount_type} onValueChange={(v) => set({ discount_type: v as "percent" | "amount" })}>
              <SelectTrigger className={field}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percentage (%)</SelectItem>
                <SelectItem value="amount">Fixed amount (֏)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">{f.discount_type === "percent" ? "Percent off" : "Amount off (֏)"}</Label>
            <Input type="number" min={1} value={f.discount_value} onChange={(e) => set({ discount_value: e.target.value })} placeholder={f.discount_type === "percent" ? "10" : "5000"} className={field} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label className="text-xs font-semibold">Code valid from</Label><Input type="date" value={f.code_starts_at} onChange={(e) => set({ code_starts_at: e.target.value })} className={field} /></div>
          <div className="grid gap-1.5"><Label className="text-xs font-semibold">Code expires</Label><Input type="date" value={f.code_ends_at} onChange={(e) => set({ code_ends_at: e.target.value })} className={field} /></div>
          <div className="grid gap-1.5"><Label className="text-xs font-semibold">Travel from</Label><Input type="date" value={f.travel_start} onChange={(e) => set({ travel_start: e.target.value })} className={field} /></div>
          <div className="grid gap-1.5"><Label className="text-xs font-semibold">Travel until</Label><Input type="date" value={f.travel_end} onChange={(e) => set({ travel_end: e.target.value })} className={field} /></div>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold">Allowed days <span className="font-normal text-basalt/45">(check-in / activity day; none = any)</span></Label>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => (
              <button key={i} type="button" onClick={() => toggleDay(i)} className={cn("h-9 w-11 border text-xs font-bold transition-colors", f.allowed_days.includes(i) ? "border-apricot bg-apricot/10 text-basalt" : "border-basalt/15 text-basalt/55 hover:border-apricot/60")}>{d}</button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5"><Label className="text-xs font-semibold">Min stay (nights)</Label><Input type="number" min={0} value={f.min_stay_nights} onChange={(e) => set({ min_stay_nights: e.target.value })} placeholder="Stays only" className={field} /></div>
          <div className="grid gap-1.5"><Label className="text-xs font-semibold">Max total uses</Label><Input type="number" min={0} value={f.max_redemptions} onChange={(e) => set({ max_redemptions: e.target.value })} placeholder="Unlimited" className={field} /></div>
          <div className="grid gap-1.5"><Label className="text-xs font-semibold">Uses per guest</Label><Input type="number" min={0} value={f.per_user_limit} onChange={(e) => set({ per_user_limit: e.target.value })} placeholder="Unlimited" className={field} /></div>
        </div>

        <label className="flex items-center gap-2.5 text-sm">
          <Checkbox checked={f.show_on_listing} onCheckedChange={(c) => set({ show_on_listing: c === true })} className="rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot" />
          <span>Show as a badge on the listing (advertises the deal publicly)</span>
        </label>
        {f.show_on_listing && (
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">Badge text <span className="font-normal text-basalt/45">(optional — defaults to "{f.discount_type === "percent" ? `${f.discount_value || "10"}% OFF` : "amount off"}")</span></Label>
            <Input value={f.tag_label} onChange={(e) => set({ tag_label: e.target.value })} placeholder="Summer deal" className={field} />
          </div>
        )}

        <label className="flex items-center gap-2.5 text-sm">
          <Checkbox checked={f.active} onCheckedChange={(c) => set({ active: c === true })} className="rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot" />
          <span>Active</span>
        </label>

        <div>
          <Button onClick={save} disabled={saving} className="rounded-none bg-apricot text-white hover:bg-apricot/90">
            {saving ? "Saving…" : editingId ? "Update code" : <><Plus className="mr-1 h-4 w-4" /> Create code</>}
          </Button>
        </div>
      </div>

      {/* Existing codes */}
      {loading ? (
        <p className="text-sm text-basalt/45">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-basalt/45">No codes yet.</p>
      ) : (
        <div className="grid gap-2">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-basalt/10 bg-paper p-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-basalt">
                  <span className="font-mono">{r.code}</span>{" "}
                  <span className="text-basalt/55">· {r.discount_type === "percent" ? `${r.discount_value}% off` : `${format(r.discount_value)} off`} · {listingTitle(r.listing_id)}</span>
                </p>
                <p className="mt-0.5 text-xs text-basalt/45">
                  {[
                    r.code_ends_at ? `until ${r.code_ends_at}` : null,
                    r.travel_start || r.travel_end ? `travel ${r.travel_start ?? "…"}→${r.travel_end ?? "…"}` : null,
                    r.allowed_days?.length ? r.allowed_days.map((d) => DAYS[d]).join("/") : null,
                    r.min_stay_nights ? `${r.min_stay_nights}+ nights` : null,
                    r.max_redemptions != null ? `max ${r.max_redemptions}` : null,
                    r.show_on_listing ? `badge: ${promoBadgeText(r, format)}` : null,
                  ].filter(Boolean).join(" · ") || "No restrictions"}
                </p>
              </div>
              <button type="button" onClick={() => toggleActive(r)} className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em]", r.active ? "bg-sevan text-white" : "bg-basalt/15 text-basalt/55")}>{r.active ? "Active" : "Off"}</button>
              <button type="button" onClick={() => edit(r)} className="grid h-8 w-8 place-items-center border border-basalt/15 text-basalt/60 hover:border-apricot hover:text-apricot"><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => remove(r.id)} className="grid h-8 w-8 place-items-center border border-basalt/15 text-basalt/60 hover:border-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
