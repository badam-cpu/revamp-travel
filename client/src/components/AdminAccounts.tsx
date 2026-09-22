/**
 * Admin — accounts & roles. Lists non-admin profiles (public read) and lets an
 * admin promote a traveler to operator (so they can own/manage listings and show
 * up in the "assign products to operators" dropdown) or demote back. The role
 * change itself goes through the server (service role) — see adminSetRole /
 * POST /api/admin-set-role — because profiles RLS only lets a user edit their
 * own non-role fields. Admin accounts are not shown/editable here.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { adminSetRole } from "@/lib/api";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface Account {
  id: string;
  role: "traveler" | "operator" | "admin";
  name: string;
}

export function AdminAccounts() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // select("*") stays resilient if logo_url (0037) isn't added yet.
    const { data } = await supabase.from("profiles").select("*");
    const rows = (data ?? [])
      .map((p) => {
        const r = p as { id: string; role: string; business_name?: string | null; display_name?: string | null };
        return { id: r.id, role: (r.role as Account["role"]) ?? "traveler", name: r.business_name || r.display_name || "Account" };
      })
      .filter((a) => a.role !== "admin")
      .sort((a, b) => a.name.localeCompare(b.name));
    setAccounts(rows);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setRole = async (acc: Account, role: "traveler" | "operator") => {
    setBusyId(acc.id);
    try {
      await adminSetRole(acc.id, role);
      setAccounts((prev) => prev?.map((a) => (a.id === acc.id ? { ...a, role } : a)) ?? prev);
      toast(`${acc.name} is now ${role === "operator" ? "an operator" : "a traveler"}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't change that account's role.");
    } finally {
      setBusyId(null);
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (accounts ?? []).filter((a) => !needle || a.name.toLowerCase().includes(needle));
  }, [accounts, q]);

  return (
    <div>
      <div className="mb-6">
        <p className="eyebrow">Accounts</p>
        <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Accounts &amp; roles.</h2>
        <p className="mt-2 max-w-xl text-sm text-basalt/55">Promote a traveler to an operator so they can own and manage listings — they'll then appear in the "assign products to operators" dropdown. Admin accounts aren't shown here.</p>
      </div>

      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" className="mb-5 h-11 max-w-md rounded-none" />

      {accounts === null ? (
        <div className="grid place-items-center py-16 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-basalt/50">No accounts{q ? " match that search" : ""}.</p>
      ) : (
        <ul className="grid gap-2">
          {filtered.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 border border-basalt/12 bg-paper px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-basalt">{a.name}</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-[0.1em] text-basalt/40">{a.role}</p>
              </div>
              {a.role === "traveler" ? (
                <Button size="sm" disabled={busyId === a.id} onClick={() => setRole(a, "operator")} className="rounded-none bg-apricot text-white hover:bg-apricot/90">
                  {busyId === a.id ? "…" : "Make operator"}
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled={busyId === a.id} onClick={() => setRole(a, "traveler")} className="rounded-none border-basalt/20">
                  {busyId === a.id ? "…" : "Make traveler"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
