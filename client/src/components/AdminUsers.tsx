/**
 * Admin — Users / manage. A searchable, filterable directory of every account,
 * merging auth email/phone with the profile role/name and each user's listing +
 * booking activity (server: POST /api/admin-users, service-role). Filter by
 * Booking ID, User ID, email, phone, name, role, or activity; promote/demote
 * roles inline (reuses /api/admin-set-role). Adapted from an OTA "User / manage"
 * layout to Revamp's actual data.
 */
import { useCallback, useEffect, useState } from "react";
import { adminUsers, adminSetRole, ApiError, type AdminUserRow, type AdminUsersFilters } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const BLANK = { bookingId: "", userId: "", email: "", phone: "", name: "", role: "all", flag: "all" };

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");

export function AdminUsers() {
  const [draft, setDraft] = useState({ ...BLANK });
  const [applied, setApplied] = useState<AdminUsersFilters | null>({});
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pageSize = 25;

  const setField = (k: keyof typeof BLANK, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const load = useCallback(async (filters: AdminUsersFilters, pg: number) => {
    setLoading(true);
    try {
      const r = await adminUsers({ ...filters, page: pg, pageSize });
      setRows(r.users);
      setTotal(r.total);
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't load users.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (applied) load(applied, page); }, [applied, page, load]);

  const apply = () => {
    const f: AdminUsersFilters = {
      bookingId: draft.bookingId.trim() || undefined,
      userId: draft.userId.trim() || undefined,
      email: draft.email.trim() || undefined,
      phone: draft.phone.trim() || undefined,
      name: draft.name.trim() || undefined,
      role: draft.role === "all" ? undefined : draft.role,
      flag: draft.flag === "all" ? undefined : draft.flag,
    };
    setPage(1);
    setApplied(f);
  };

  const reset = () => { setDraft({ ...BLANK }); setPage(1); setApplied({}); };

  const changeRole = async (u: AdminUserRow, role: "traveler" | "operator") => {
    setBusyId(u.id);
    try {
      await adminSetRole(u.id, role);
      setRows((prev) => prev?.map((r) => (r.id === u.id ? { ...r, role } : r)) ?? prev);
      toast.success(`${u.displayName || u.businessName || "Account"} is now ${role === "operator" ? "an operator" : "a traveler"}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't change that account's role.");
    } finally {
      setBusyId(null);
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="grid gap-6">
      <div>
        <p className="eyebrow">Users</p>
        <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">User / manage.</h2>
        <p className="mt-2 max-w-xl text-sm text-basalt/55">Search accounts by any field, filter by role or activity, and promote/demote operators. Email and phone come from the auth record; listings and bookings are live counts.</p>
      </div>

      {/* Filter panel */}
      <div className="grid gap-4 border border-basalt/12 bg-paper p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Input value={draft.bookingId} onChange={(e) => setField("bookingId", e.target.value)} placeholder="Booking ID" className="h-10 rounded-none" />
          <Input value={draft.userId} onChange={(e) => setField("userId", e.target.value)} placeholder="User ID" className="h-10 rounded-none" />
          <Input value={draft.email} onChange={(e) => setField("email", e.target.value)} placeholder="Email" className="h-10 rounded-none" />
          <Input value={draft.phone} onChange={(e) => setField("phone", e.target.value)} placeholder="Phone number" className="h-10 rounded-none" />
          <Input value={draft.name} onChange={(e) => setField("name", e.target.value)} placeholder="Name (display or business)" className="h-10 rounded-none" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={draft.role} onValueChange={(v) => setField("role", v)}>
            <SelectTrigger className="h-10 rounded-none"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="traveler">Travelers</SelectItem>
              <SelectItem value="operator">Operators</SelectItem>
              <SelectItem value="admin">Admins</SelectItem>
            </SelectContent>
          </Select>
          <Select value={draft.flag} onValueChange={(v) => setField("flag", v)}>
            <SelectTrigger className="h-10 rounded-none"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All activity</SelectItem>
              <SelectItem value="has_listings">Has listings</SelectItem>
              <SelectItem value="has_bookings">Has bookings</SelectItem>
              <SelectItem value="no_activity">No activity</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-5 border-t border-basalt/8 pt-4">
          <button type="button" onClick={reset} className="text-sm font-semibold text-red-500 hover:underline">Reset</button>
          <Button onClick={apply} disabled={loading} className="h-9 rounded-none bg-apricot text-white hover:bg-apricot/90">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Filter"}</Button>
          {rows && <span className="text-xs text-basalt/50">{total} account{total === 1 ? "" : "s"}</span>}
        </div>
      </div>

      {/* Results */}
      {rows === null ? (
        <div className="grid place-items-center py-16 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-basalt/50">No accounts match those filters.</p>
      ) : (
        <div className="overflow-x-auto border border-basalt/12">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-basalt/12 bg-chalk/40 text-left text-[11px] uppercase tracking-[0.08em] text-basalt/50">
                <th className="px-3 py-2.5 font-semibold">Account</th>
                <th className="px-3 py-2.5 font-semibold">Contact</th>
                <th className="px-3 py-2.5 font-semibold">Role</th>
                <th className="px-3 py-2.5 text-right font-semibold">Listings</th>
                <th className="px-3 py-2.5 text-right font-semibold">Bookings</th>
                <th className="px-3 py-2.5 font-semibold">Joined</th>
                <th className="px-3 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-basalt/8 last:border-0 align-top">
                  <td className="px-3 py-3">
                    <p className="font-semibold text-basalt">{u.displayName || u.businessName || "—"}</p>
                    {u.businessName && u.displayName && u.businessName !== u.displayName && <p className="text-xs text-basalt/50">{u.businessName}</p>}
                    <p className="mt-0.5 select-all font-mono text-[10px] text-basalt/35">{u.id}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="break-all text-basalt/80">{u.email || <span className="text-basalt/35">no email</span>}</p>
                    {u.phone && <p className="text-xs text-basalt/50">{u.phone}</p>}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-block px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] ${u.role === "admin" ? "bg-basalt text-paper" : u.role === "operator" ? "bg-apricot/15 text-apricot" : "bg-basalt/8 text-basalt/60"}`}>{u.role}</span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-basalt/70">{u.listingCount || "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-basalt/70">{u.bookingCount || "—"}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-basalt/60">{fmtDate(u.createdAt)}</td>
                  <td className="px-3 py-3 text-right">
                    {u.role === "traveler" && (
                      <Button size="sm" disabled={busyId === u.id} onClick={() => changeRole(u, "operator")} className="h-8 rounded-none bg-apricot text-white hover:bg-apricot/90">{busyId === u.id ? "…" : "Make operator"}</Button>
                    )}
                    {u.role === "operator" && (
                      <Button size="sm" variant="outline" disabled={busyId === u.id} onClick={() => changeRole(u, "traveler")} className="h-8 rounded-none border-basalt/20">{busyId === u.id ? "…" : "Make traveler"}</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {rows && rows.length > 0 && pages > 1 && (
        <div className="flex items-center justify-center gap-4 text-sm">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))} className="font-semibold text-apricot disabled:text-basalt/30 hover:underline disabled:no-underline">Previous</button>
          <span className="text-basalt/55">Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)} className="font-semibold text-apricot disabled:text-basalt/30 hover:underline disabled:no-underline">Next</button>
        </div>
      )}
    </div>
  );
}
