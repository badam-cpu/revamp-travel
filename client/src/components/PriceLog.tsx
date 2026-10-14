/**
 * Price log (migration 0103): every price change, whatever made it — the
 * listing form, the calendars, an event "Apply", PriceLabs sync, an admin.
 * Rows come from DB triggers (see the migration); RLS scopes them to the
 * operator's own listings (admins see all). Operators: Dashboard → Calendar →
 * Price log. Admins: /admin → Price log.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { describeRateChange } from "@shared/priceLog";
import { roomUnitLabel } from "@shared/rooms";
import { cn } from "@/lib/utils";

type Field = "base_price" | "date_prices" | "extra_fee" | "extra_guest_fee";
interface Row {
  id: number;
  listing_id: string;
  room_type_id: string | null;
  room_unit_id: string | null;
  field: Field;
  old_value: unknown;
  new_value: unknown;
  changed_by: string | null;
  changed_at: string;
  listings: { title: string; operator_id: string } | null;
  room_types: { name: string } | null;
  room_units: { name: string } | null;
}

const PERIODS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 0, label: "All" },
] as const;

const fmtDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtRange = (a: string, b: string) => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);
const dayHeading = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function PriceLog({ scope }: { scope: "operator" | "admin" }) {
  const { format } = useCurrency();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [period, setPeriod] = useState<number>(30);
  const [listing, setListing] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let live = true;
    setFailed(false);
    let q = supabase
      .from("price_changes")
      .select("id, listing_id, room_type_id, room_unit_id, field, old_value, new_value, changed_by, changed_at, listings(title, operator_id), room_types(name), room_units(name)")
      .order("changed_at", { ascending: false })
      .limit(500);
    if (period) q = q.gte("changed_at", new Date(Date.now() - period * 86_400_000).toISOString());
    q.then(async ({ data, error }) => {
      if (!live) return;
      if (error) {
        console.error("[price-log] load failed", error.message);
        setFailed(true);
        setRows([]);
        return;
      }
      const loaded = (data ?? []) as unknown as Row[];
      setRows(loaded);
      // Who made each change (and, for admins, whose listing it is).
      const ids = Array.from(new Set(loaded.flatMap((r) => [r.changed_by, scope === "admin" ? r.listings?.operator_id : null]).filter(Boolean) as string[]));
      if (!ids.length) return;
      const { data: profiles } = await supabase.from("profiles").select("id, display_name, business_name").in("id", ids);
      if (live) setNames(new Map(((profiles ?? []) as { id: string; display_name: string | null; business_name: string | null }[]).map((p) => [p.id, p.business_name || p.display_name || "Someone"])));
    });
    return () => {
      live = false;
    };
  }, [period, scope]);

  const listings = useMemo(() => {
    const m = new Map<string, string>();
    (rows ?? []).forEach((r) => m.set(r.listing_id, r.listings?.title ?? "Listing"));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const shown = (rows ?? []).filter((r) => !listing || r.listing_id === listing);
  const byDay = useMemo(() => {
    const out: { day: string; rows: Row[] }[] = [];
    for (const r of shown) {
      const day = r.changed_at.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(r);
      else out.push({ day, rows: [r] });
    }
    return out;
  }, [shown]);

  const money = (v: unknown) => (typeof v === "number" ? format(v) : "—");
  const who = (r: Row) => {
    if (!r.changed_by) return "Automatic (e.g. PriceLabs sync)";
    const name = names.get(r.changed_by) ?? "Someone";
    if (scope === "operator") return name;
    return r.listings && r.changed_by !== r.listings.operator_id ? `${name} (admin)` : name;
  };
  const what = (r: Row): { title: string; lines: string[] } => {
    const target = r.room_unit_id ? "Room price" : r.room_type_id ? "Room type price" : "Base price";
    if (r.field === "base_price") return { title: `${target}: ${r.room_unit_id && r.old_value == null ? "type price" : money(r.old_value)} → ${r.room_unit_id && r.new_value == null ? "type price" : money(r.new_value)}`, lines: [] };
    if (r.field === "extra_fee") return { title: `Extra fee: ${money(r.old_value)} → ${money(r.new_value)}`, lines: [] };
    if (r.field === "extra_guest_fee") return { title: `Extra-guest fee: ${money(r.old_value)} → ${money(r.new_value)}`, lines: [] };
    const changes = describeRateChange(r.old_value, r.new_value);
    const lines = changes.map((c) => `${fmtRange(c.start, c.end)}: ${c.from == null ? "usual price" : format(c.from)} → ${c.to == null ? "usual price" : format(c.to)}${c.label ? ` · ${c.label}` : ""}`);
    return { title: `Date prices${r.room_unit_id ? " (this room)" : r.room_type_id ? " (room type)" : ""}: ${changes.length} change${changes.length === 1 ? "" : "s"}`, lines };
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Period" className="inline-flex rounded-full border border-basalt/15 bg-paper p-1">
          {PERIODS.map((p) => (
            <button key={p.days} type="button" aria-pressed={period === p.days} onClick={() => setPeriod(p.days)} className={cn("h-8 rounded-full px-3 text-xs font-semibold", period === p.days ? "bg-basalt text-paper" : "text-basalt/70 hover:text-basalt")}>
              {p.label}
            </button>
          ))}
        </div>
        {listings.length > 1 && (
          <div className="relative inline-flex items-center">
            <select aria-label="Listing" value={listing} onChange={(e) => setListing(e.target.value)} className="h-10 max-w-[18rem] appearance-none rounded-full border border-basalt/15 bg-paper pl-4 pr-9 text-sm font-semibold hover:border-basalt/40 focus:border-basalt focus:outline-none">
              <option value="">All listings</option>
              {listings.map(([id, title]) => (
                <option key={id} value={id}>{title}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-basalt/70" />
          </div>
        )}
      </div>

      {rows === null ? (
        <div aria-busy="true" className="grid gap-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse bg-chalk" />)}</div>
      ) : failed ? (
        <p className="border border-basalt/12 bg-chalk px-5 py-6 text-sm text-basalt/70">The price log isn't available right now. Please try again later.</p>
      ) : shown.length === 0 ? (
        <p className="border border-dashed border-basalt/20 bg-chalk px-5 py-8 text-center text-sm text-basalt/70">No price changes in this period. Every change to {scope === "admin" ? "any listing's" : "your"} prices will appear here.</p>
      ) : (
        <div className="grid gap-5">
          {byDay.map(({ day, rows: dayRows }) => (
            <section key={day}>
              <h3 className="mb-2 text-xs font-semibold text-basalt/60">{dayHeading(day + "T12:00:00Z")}</h3>
              <ul className="divide-y divide-basalt/10 border border-basalt/10 bg-paper">
                {dayRows.map((r) => {
                  const w = what(r);
                  const open = expanded.has(r.id);
                  const more = w.lines.length - 3;
                  return (
                    <li key={r.id} className="grid gap-x-4 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[4rem_minmax(0,1fr)_auto]">
                      <span className="tabular-nums text-basalt/60">{time(r.changed_at)}</span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {r.listings?.title ?? "Listing"}
                          {r.room_types?.name ? <span className="font-normal text-basalt/60"> · {r.room_types.name}</span> : null}
                          {r.room_units?.name ? <span className="font-normal text-basalt/60"> · {roomUnitLabel(r.room_units.name)}</span> : null}
                        </p>
                        <p className="text-basalt/80">{w.title}</p>
                        {w.lines.length > 0 && (
                          <ul className="mt-1 grid gap-0.5 tabular-nums text-basalt/70">
                            {(open ? w.lines : w.lines.slice(0, 3)).map((l, i) => (
                              <li key={i}>{l}</li>
                            ))}
                          </ul>
                        )}
                        {more > 0 && (
                          <button type="button" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} className="mt-1 text-xs font-semibold text-basalt/60 underline-offset-4 hover:text-apricot hover:underline">
                            {open ? "Show less" : `Show ${more} more`}
                          </button>
                        )}
                      </div>
                      <span className="text-xs text-basalt/60 sm:text-right">
                        {who(r)}
                        {scope === "admin" && r.listings && names.get(r.listings.operator_id) ? <span className="block">Listing of {names.get(r.listings.operator_id)}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
