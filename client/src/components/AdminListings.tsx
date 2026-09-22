/**
 * Admin — assign/reassign a listing (product) to an operator. Admins can update
 * any listing under RLS (is_admin), and the review-gate trigger only guards
 * `status`, so changing `operator_id` is allowed with no migration. The operator
 * dropdown lists only role='operator' profiles, so a product can't be assigned
 * to a traveler. Reassigning affects who sees/edits the listing in their
 * dashboard and who future payouts accrue to; existing bookings/payouts keep
 * their recorded amounts.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !needle || r.title.toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <div>
      <div className="mb-6">
        <p className="eyebrow">Listings</p>
        <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Assign products to operators.</h2>
        <p className="mt-2 max-w-xl text-sm text-basalt/55">Reassign any listing to a different operator. The new operator manages it from their dashboard and future payouts accrue to them. Only operator accounts are listed.</p>
      </div>

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
              <div className="flex items-center gap-2">
                <select
                  value={r.operator_id}
                  disabled={savingId === r.id}
                  onChange={(e) => assign(r, e.target.value)}
                  className="h-10 rounded-none border border-basalt/20 bg-paper px-2 text-sm outline-none focus:border-apricot disabled:opacity-50"
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
