/**
 * Admin — Users / manage. A searchable, filterable directory of every account,
 * merging auth email/phone with the profile role/name and each user's listing +
 * booking activity (server: POST /api/admin-users, service-role). Filter by
 * Booking ID, User ID, email, phone, name, role, or activity; promote/demote
 * roles inline (reuses /api/admin-set-role). Adapted from an OTA "User / manage"
 * layout to Revamp's actual data.
 */
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { adminUsers, adminSetRole, ApiError, type AdminUserRow, type AdminUsersFilters } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { startImpersonation } from "@/lib/impersonation";

const BLANK = { bookingId: "", userId: "", email: "", phone: "", name: "", role: "all", flag: "all", signIn: "all", sort: "joined" };

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");
const fmtDateTime = (s: string) => new Date(s).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** "Today", "Yesterday", "5 days ago", "3 months ago" — the exact time is in the tooltip. */
function ago(s: string): string {
  const days = Math.floor((Date.now() - Date.parse(s)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

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
      signIn: draft.signIn === "all" ? undefined : draft.signIn,
      sort: draft.sort === "joined" ? undefined : draft.sort,
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

  // Sign this browser in as the operator (0093) to apply changes on their
  // behalf; the bar at the top leads back here.
  const logInAs = async (u: AdminUserRow) => {
    const name = u.businessName || u.displayName || u.email || "this operator";
    if (!window.confirm(`Log in as ${name}?\n\nYou'll see and change their account exactly as they do, until you choose "Return to admin" in the bar at the top.`)) return;
    setBusyId(u.id);
    try {
      await startImpersonation(u.id);
      window.location.assign("/dashboard");
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't open this account. Please try again.");
      setBusyId(null);
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="grid gap-6">
      <PageHeader className="mb-0" title="Users" sub="Search and filter accounts, and promote or demote operators. Last sign-in is when they last signed in, not every visit — staying signed in doesn't update it." />

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
          <Select value={draft.signIn} onValueChange={(v) => setField("signIn", v)}>
            <SelectTrigger className="h-10 rounded-none" aria-label="Last sign-in"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any last sign-in</SelectItem>
              <SelectItem value="7d">Signed in last 7 days</SelectItem>
              <SelectItem value="30d">Signed in last 30 days</SelectItem>
              <SelectItem value="inactive_30d">No sign-in for 30+ days</SelectItem>
              <SelectItem value="never">Never signed in</SelectItem>
            </SelectContent>
          </Select>
          <Select value={draft.sort} onValueChange={(v) => setField("sort", v)}>
            <SelectTrigger className="h-10 rounded-none" aria-label="Sort"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="joined">Newest accounts first</SelectItem>
              <SelectItem value="last_sign_in">Most recent sign-in first</SelectItem>
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
          <table className="w-full min-w-[940px] text-sm">
            <thead>
              <tr className="border-b border-basalt/12 bg-chalk/40 text-left text-[11px] uppercase tracking-[0.08em] text-basalt/50">
                <th className="px-3 py-2.5 font-semibold">Account</th>
                <th className="px-3 py-2.5 font-semibold">Contact</th>
                <th className="px-3 py-2.5 font-semibold">Role</th>
                <th className="px-3 py-2.5 text-right font-semibold">Listings</th>
                <th className="px-3 py-2.5 text-right font-semibold">Bookings</th>
                <th className="px-3 py-2.5 font-semibold">Joined</th>
                <th className="px-3 py-2.5 font-semibold">Last sign-in</th>
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
                  <td className="px-3 py-3 whitespace-nowrap">
                    {u.lastSignInAt ? (
                      <>
                        <p className="text-basalt/80" title={fmtDateTime(u.lastSignInAt)}>{ago(u.lastSignInAt)}</p>
                        <p className="text-xs text-basalt/45">{u.lastSignInByAdmin ? "by an admin (Log in as)" : fmtDate(u.lastSignInAt)}</p>
                      </>
                    ) : (
                      <span className="text-basalt/35">Never</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {u.role === "traveler" && (
                      <Button size="sm" disabled={busyId === u.id} onClick={() => changeRole(u, "operator")} className="h-8 rounded-none bg-apricot text-white hover:bg-apricot/90">{busyId === u.id ? "…" : "Make operator"}</Button>
                    )}
                    {u.role === "operator" && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" disabled={busyId === u.id} onClick={() => logInAs(u)} className="h-8 rounded-none bg-basalt text-paper hover:bg-basalt/90">
                          <LogIn className="mr-1.5 h-3.5 w-3.5" /> Log in as
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === u.id} onClick={() => changeRole(u, "traveler")} className="h-8 rounded-none border-basalt/20">{busyId === u.id ? "…" : "Make traveler"}</Button>
                      </div>
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

      <AdminAccessLog />
    </div>
  );
}

type AccessRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  admin: { display_name: string | null } | null;
  operator: { display_name: string | null; business_name: string | null } | null;
};

/** Who opened which operator account, and for how long (admins only, by RLS). Hidden until 0093 runs. */
function AdminAccessLog() {
  const [rows, setRows] = useState<AccessRow[] | null>(null);
  useEffect(() => {
    supabase
      .from("admin_impersonations")
      .select("id, started_at, ended_at, admin:profiles!admin_impersonations_admin_id_fkey(display_name), operator:profiles!admin_impersonations_operator_id_fkey(display_name, business_name)")
      .order("started_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => setRows(error ? [] : ((data ?? []) as unknown as AccessRow[])));
  }, []);
  if (!rows || rows.length === 0) return null;

  const fmt = (s: string) => new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const duration = (a: string, b: string) => {
    const mins = Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));
    return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
  };

  return (
    <div className="grid gap-3">
      <div>
        <p className="text-sm font-semibold">Admin access log</p>
        <p className="text-xs text-basalt/50">Every time an admin logged in as an operator. Only admins can see this.</p>
      </div>
      <div className="overflow-x-auto border border-basalt/12">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-basalt/12 bg-chalk/40 text-left text-[11px] uppercase tracking-[0.08em] text-basalt/50">
              <th className="px-3 py-2 font-semibold">Admin</th>
              <th className="px-3 py-2 font-semibold">Operator account</th>
              <th className="px-3 py-2 font-semibold">Started</th>
              <th className="px-3 py-2 font-semibold">Length</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-basalt/8 last:border-0">
                <td className="px-3 py-2">{r.admin?.display_name || "—"}</td>
                <td className="px-3 py-2">{r.operator?.business_name || r.operator?.display_name || "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap text-basalt/70">{fmt(r.started_at)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-basalt/70">
                  {r.ended_at ? duration(r.started_at, r.ended_at) : <span className="font-semibold text-apricot">Active now</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
