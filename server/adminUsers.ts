/**
 * Admin user directory. Merges the three places a "user" actually lives —
 * auth.users (email / phone / sign-in dates), public.profiles (role + names),
 * and activity counts (listings owned, bookings made) — into one searchable,
 * filterable list for the admin Users view. Service-role only (auth admin API +
 * cross-user reads). Built in memory: at this app's scale a full merge is far
 * simpler and more correct than trying to push every filter into three queries.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AdminUserRow {
  id: string;
  email: string | null;
  phone: string | null;
  role: "traveler" | "operator" | "admin";
  displayName: string | null;
  businessName: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  listingCount: number;
  bookingCount: number;
}

export interface AdminUserFilters {
  userId?: string;
  email?: string;
  phone?: string;
  name?: string;
  bookingId?: string;
  role?: "traveler" | "operator" | "admin" | "";
  flag?: "has_listings" | "has_bookings" | "no_activity" | "";
  page?: number;
  pageSize?: number;
}

interface AuthInfo { email: string | null; phone: string | null; createdAt: string | null; lastSignInAt: string | null }

async function authIndex(admin: SupabaseClient): Promise<Map<string, AuthInfo>> {
  const map = new Map<string, AuthInfo>();
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const users = data?.users ?? [];
    if (error || users.length === 0) break;
    for (const u of users) {
      map.set(u.id, {
        email: u.email ?? null,
        phone: (u.phone as string | undefined) ?? null,
        createdAt: u.created_at ?? null,
        lastSignInAt: (u.last_sign_in_at as string | undefined) ?? null,
      });
    }
    if (users.length < 1000) break;
  }
  return map;
}

/** id → count, tallied from a single column projection. */
async function tally(admin: SupabaseClient, table: string, column: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data } = await admin.from(table).select(column);
  for (const row of (data ?? []) as unknown as Record<string, string | null>[]) {
    const key = row[column];
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const digits = (s: string) => s.replace(/\D/g, "");

export async function listAdminUsers(
  admin: SupabaseClient,
  filters: AdminUserFilters,
): Promise<{ users: AdminUserRow[]; total: number; page: number; pageSize: number }> {
  // A Booking ID narrows to that booking's traveler up front.
  let bookingTraveler: string | null = null;
  if (filters.bookingId?.trim()) {
    const { data } = await admin.from("bookings").select("traveler_id").eq("id", filters.bookingId.trim()).maybeSingle();
    bookingTraveler = (data as { traveler_id: string | null } | null)?.traveler_id ?? "__none__";
  }

  const [auth, profs, listingCounts, bookingCounts] = await Promise.all([
    authIndex(admin),
    admin.from("profiles").select("id, role, display_name, business_name, created_at").then((r) => r.data ?? []),
    tally(admin, "listings", "operator_id"),
    tally(admin, "bookings", "traveler_id"),
  ]);

  let rows: AdminUserRow[] = (profs as { id: string; role: string; display_name: string | null; business_name: string | null; created_at: string | null }[]).map((p) => {
    const a = auth.get(p.id);
    return {
      id: p.id,
      email: a?.email ?? null,
      phone: a?.phone ?? null,
      role: (p.role as AdminUserRow["role"]) ?? "traveler",
      displayName: p.display_name,
      businessName: p.business_name,
      createdAt: a?.createdAt ?? p.created_at,
      lastSignInAt: a?.lastSignInAt ?? null,
      listingCount: listingCounts.get(p.id) ?? 0,
      bookingCount: bookingCounts.get(p.id) ?? 0,
    };
  });

  // Filters (all AND-ed; blank fields ignored).
  const f = filters;
  if (bookingTraveler) rows = rows.filter((r) => r.id === bookingTraveler);
  if (f.userId?.trim()) { const q = f.userId.trim().toLowerCase(); rows = rows.filter((r) => r.id.toLowerCase().includes(q)); }
  if (f.email?.trim()) { const q = f.email.trim().toLowerCase(); rows = rows.filter((r) => (r.email ?? "").toLowerCase().includes(q)); }
  if (f.phone?.trim()) { const q = digits(f.phone); rows = rows.filter((r) => digits(r.phone ?? "").includes(q)); }
  if (f.name?.trim()) { const q = f.name.trim().toLowerCase(); rows = rows.filter((r) => `${r.displayName ?? ""} ${r.businessName ?? ""}`.toLowerCase().includes(q)); }
  if (f.role) rows = rows.filter((r) => r.role === f.role);
  if (f.flag === "has_listings") rows = rows.filter((r) => r.listingCount > 0);
  else if (f.flag === "has_bookings") rows = rows.filter((r) => r.bookingCount > 0);
  else if (f.flag === "no_activity") rows = rows.filter((r) => r.listingCount === 0 && r.bookingCount === 0);

  rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const total = rows.length;
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 100);
  const page = Math.max(f.page ?? 1, 1);
  const start = (page - 1) * pageSize;
  return { users: rows.slice(start, start + pageSize), total, page, pageSize };
}
