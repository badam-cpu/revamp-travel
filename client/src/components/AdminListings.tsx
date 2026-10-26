/**
 * Admin — assign/reassign a listing (product) to an operator. Admins can update
 * any listing under RLS (is_admin), and the review-gate trigger only guards
 * `status`, so changing `operator_id` is allowed with no migration. The operator
 * dropdown lists only role='operator' profiles, so a product can't be assigned
 * to a traveler. Reassigning affects who sees/edits the listing in their
 * dashboard and who future payouts accrue to; existing bookings/payouts keep
 * their recorded amounts.
 *
 * Also: switch a listing between Tour and Experience. The two share every
 * column (same detail page, sessions, booking, payouts), so only `type` changes
 * — the page address, bookings, photos and prices stay. It moves the listing to
 * the other section (/explore/tour ↔ /explore/experience, home rows, region
 * pages, the operator's dashboard section). Other types have different data and
 * aren't offered. Admin RLS allows it; the review gate only guards `status`.
 */
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/lib/supabase";
import { useListings } from "@/contexts/ListingsContext";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

interface Row {
  id: string;
  title: string;
  type: string;
  status: string;
  operator_id: string;
}
interface Op {
  id: string;
  name: string;
}

export function AdminListings() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [q, setQ] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const { refresh } = useListings();

  const load = async () => {
    const [{ data: listings }, { data: profiles }] = await Promise.all([
      supabase.from("listings").select("id, title, type, status, operator_id").order("title", { ascending: true }),
      // select("*") stays resilient if logo_url (0037) isn't added yet.
      supabase.from("profiles").select("*").eq("role", "operator"),
    ]);
    setRows((listings ?? []) as Row[]);
    const opList = (profiles ?? []).map((p) => {
      const r = p as { id: string; business_name?: string | null; display_name?: string | null };
      return { id: r.id, name: r.business_name || r.display_name || "Operator" };
    });
    opList.sort((a, b) => a.name.localeCompare(b.name));
    setOps(opList);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assign = async (row: Row, operatorId: string) => {
    if (operatorId === row.operator_id) return;
    setSavingId(row.id);
    const prev = row.operator_id;
    setRows((rs) => rs?.map((r) => (r.id === row.id ? { ...r, operator_id: operatorId } : r)) ?? rs);
    try {
      const { error } = await supabase.from("listings").update({ operator_id: operatorId }).eq("id", row.id);
      if (error) throw new Error(error.message);
      toast(`"${row.title}" assigned to ${ops.find((o) => o.id === operatorId)?.name ?? "operator"}.`);
    } catch (e) {
      setRows((rs) => rs?.map((r) => (r.id === row.id ? { ...r, operator_id: prev } : r)) ?? rs);
      toast(e instanceof Error ? e.message : "Couldn't reassign that listing.");
    } finally {
      setSavingId(null);
    }
  };

  const switchType = async (row: Row, type: "tour" | "experience") => {
    if (type === row.type) return;
    const to = type === "tour" ? "Tours" : "Experiences";
    if (!window.confirm(`Move "${row.title}" to ${to}?\n\nIts page address, bookings, photos and prices stay the same — it just shows under ${to} on the site and in the operator's dashboard.`)) return;
    setSavingId(row.id);
    const prev = row.type;
    setRows((rs) => rs?.map((r) => (r.id === row.id ? { ...r, type } : r)) ?? rs);
    try {
      const { error } = await supabase.from("listings").update({ type }).eq("id", row.id);
      if (error) throw new Error(error.message);
      toast(`"${row.title}" is now under ${to}.`);
      void refresh();
    } catch (e) {
      console.error("[admin listings] type change", e);
      setRows((rs) => rs?.map((r) => (r.id === row.id ? { ...r, type: prev } : r)) ?? rs);
      toast("Couldn't change the type — try again.");
    } finally {
      setSavingId(null);
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !needle || r.title.toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <div>
      <PageHeader title="Assign listings to operators" sub="Reassign a listing to another operator, or move a tour to Experiences (and back)." />

      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search listings by title…" className="mb-5 h-11 max-w-md rounded-none" />

      {rows === null ? (
        <div className="grid place-items-center py-16 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-basalt/50">No listings{q ? " match that search" : " yet"}.</p>
      ) : (
        <ul className="grid gap-2">
          {filtered.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 border border-basalt/12 bg-paper px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-basalt">{r.title}</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-[0.1em] text-basalt/40">{r.type} · {r.status}</p>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                {(r.type === "tour" || r.type === "experience") && (
                  <select
                    aria-label={`Type of ${r.title}`}
                    value={r.type}
                    disabled={savingId === r.id}
                    onChange={(e) => switchType(r, e.target.value as "tour" | "experience")}
                    className="h-12 rounded-none border border-basalt/20 bg-paper px-2 text-base outline-none focus:border-apricot disabled:opacity-50 sm:h-10 sm:text-sm"
                  >
                    <option value="tour">Tour</option>
                    <option value="experience">Experience</option>
                  </select>
                )}
                <select
                  aria-label={`Operator of ${r.title}`}
                  value={r.operator_id}
                  disabled={savingId === r.id}
                  onChange={(e) => assign(r, e.target.value)}
                  className="h-12 min-w-0 flex-1 rounded-none border border-basalt/20 bg-paper px-2 text-base outline-none focus:border-apricot disabled:opacity-50 sm:h-10 sm:flex-none sm:text-sm"
                >
                  {!ops.some((o) => o.id === r.operator_id) && <option value={r.operator_id}>Current owner (not an operator)</option>}
                  {ops.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                {savingId === r.id && <Loader2 className="h-4 w-4 animate-spin text-basalt/40" />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
