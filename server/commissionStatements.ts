/**
 * Monthly commission statements for operators paid directly to their own
 * PayLink account (migration 0094). Runs inside the 10-minute reconcile cron;
 * every step is idempotent, so running it often is safe.
 *
 *  1. build    — on/after the 1st, roll each operator's open ledger rows from
 *                before this month into one statement (unique per period).
 *                total > 0 → PayLink pay link on REVAMP's account + email,
 *                due 14 days later; total < 0 → "credit" (Revamp owes the
 *                operator, paid out by admin); total = 0 → nothing due.
 *  2. collect  — poll sent/overdue statements; paid → mark paid and, if their
 *                direct payments were paused for an overdue statement, resume.
 *  3. remind   — 3 days before the due date, one reminder email.
 *  4. overdue  — past the due date → overdue + pause direct payments (bookings
 *                fall back to Revamp's account) + email.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { revampPaylink } from "./paylink.js";
import { setPaymentAccountPaused, purgeDisconnectedCredentials } from "./paymentAccounts.js";
import { sendCommissionStatement, sendCommissionStatementReminder, sendDirectPaymentsPaused, type CommissionStatementEmail } from "./email.js";

export const STATEMENT_DUE_DAYS = 14;
export const REMINDER_DAYS_BEFORE = 3;
export const OVERDUE_PAUSE_REASON = "Commission statement overdue";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};

/** The month before `now` (UTC): first day, last day, first day of `now`'s month. */
export function previousPeriod(now: Date): { start: string; end: string; monthStart: string; label: string } {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevEnd = new Date(monthStart.getTime() - 86400000);
  return {
    start: ymd(prevStart),
    end: ymd(prevEnd),
    monthStart: ymd(monthStart),
    label: prevStart.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

export interface LedgerRowLike {
  kind: "charge" | "adjustment";
  commission_cents: number;
  addons_cents: number;
  gift_credit_cents: number;
  net_due_cents: number;
}

/** Statement totals from ledger rows (pure; unit-tested). */
export function statementTotals(rows: LedgerRowLike[]) {
  let commission = 0, addons = 0, gift = 0, adjustment = 0;
  for (const r of rows) {
    if (r.kind === "adjustment") adjustment += r.net_due_cents; // negative credit
    else {
      commission += r.commission_cents;
      addons += r.addons_cents;
      gift += r.gift_credit_cents;
    }
  }
  return { commission, addons, gift, adjustment, total: commission + addons - gift + adjustment };
}

type StatementRow = {
  id: string;
  operator_id: string;
  period_start: string;
  commission_cents: number;
  addons_cents: number;
  gift_credit_cents: number;
  adjustment_cents: number;
  total_due_cents: number;
  currency: string;
  status: string;
  due_date: string | null;
  reminded_at: string | null;
  paylink_request_id: string | null;
  paylink_order_id: string | null;
  pay_url: string | null;
};

function emailInfo(s: StatementRow): CommissionStatementEmail {
  const label = new Date(`${s.period_start}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return {
    periodLabel: label,
    commissionCents: s.commission_cents,
    addonsCents: s.addons_cents,
    giftCreditCents: s.gift_credit_cents,
    adjustmentCents: Math.abs(s.adjustment_cents),
    totalDueCents: s.total_due_cents,
    currency: s.currency,
    dueDate: s.due_date ?? ymd(new Date()),
    payUrl: s.pay_url,
  };
}

async function operatorEmail(admin: SupabaseClient, operatorId: string): Promise<string | null> {
  try {
    const { data } = await admin.auth.admin.getUserById(operatorId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

const SITE = () => (process.env.URL || "https://revampvacations.com").replace(/\/+$/, "");

/** Register the pay link (Revamp's account) for a positive statement and email it. */
async function issueStatement(admin: SupabaseClient, s: StatementRow, today: string): Promise<void> {
  if (s.total_due_cents <= 0 || s.pay_url) return;
  const amount = s.currency === "AMD" ? Math.round(s.total_due_cents / 100) : s.total_due_cents / 100;
  const pay = await revampPaylink.registerPayment({
    amount,
    currency: s.currency,
    returnUrl: `${SITE()}/dashboard?section=billing&statement=return`,
    info: `Revamp commission statement · ${s.period_start.slice(0, 7)}`,
  });
  if (!pay.redirectUrl) return; // retried on the next cron run
  const due = s.due_date ?? addDays(today, STATEMENT_DUE_DAYS);
  const { data: updated } = await admin
    .from("commission_statements")
    .update({ status: "sent", due_date: due, paylink_request_id: pay.requestId, pay_url: pay.redirectUrl })
    .eq("id", s.id)
    .eq("status", "open")
    .select("*")
    .maybeSingle();
  if (!updated) return;
  const to = await operatorEmail(admin, s.operator_id);
  if (to) await sendCommissionStatement(to, emailInfo(updated as StatementRow));
}

/** Step 1 — build last month's statements (idempotent per operator + period). */
export async function buildMonthlyStatements(admin: SupabaseClient, now = new Date()): Promise<number> {
  const period = previousPeriod(now);
  const today = ymd(now);
  const { data: rows, error } = await admin
    .from("direct_payment_ledger")
    .select("id, operator_id, kind, commission_cents, addons_cents, gift_credit_cents, net_due_cents, currency")
    .eq("status", "open")
    .lt("occurred_at", `${period.monthStart}T00:00:00Z`)
    .limit(5000);
  if (error || !rows?.length) return 0;

  const byOperator = new Map<string, typeof rows>();
  for (const r of rows) byOperator.set(r.operator_id as string, [...(byOperator.get(r.operator_id as string) ?? []), r]);

  let created = 0;
  for (const [operatorId, list] of Array.from(byOperator.entries())) {
    const t = statementTotals(list as unknown as LedgerRowLike[]);
    const status = t.total > 0 ? "open" : t.total < 0 ? "credit" : "paid";
    const { data: stmt, error: insErr } = await admin
      .from("commission_statements")
      .insert({
        operator_id: operatorId,
        period_start: period.start,
        period_end: period.end,
        commission_cents: t.commission,
        addons_cents: t.addons,
        gift_credit_cents: t.gift,
        adjustment_cents: t.adjustment,
        total_due_cents: t.total,
        currency: (list[0].currency as string) || "AMD",
        status,
        due_date: t.total > 0 ? addDays(today, STATEMENT_DUE_DAYS) : null,
        ...(status === "paid" ? { paid_at: now.toISOString() } : {}),
      })
      .select("*")
      .maybeSingle();
    if (insErr || !stmt) continue; // already built for this period (unique) — skip
    await admin
      .from("direct_payment_ledger")
      .update({ status: "billed", statement_id: stmt.id })
      .in("id", list.map((r) => r.id as string))
      .eq("status", "open");
    created++;
    try {
      await issueStatement(admin, stmt as StatementRow, today);
    } catch (err) {
      console.error("[statements] issue failed — retried next run", stmt.id, err);
    }
  }
  return created;
}

/** Steps 2–4 — retry unissued, collect payments, remind, flag overdue. */
export async function reconcileStatements(admin: SupabaseClient, now = new Date()): Promise<{ paid: number; reminded: number; overdue: number }> {
  const today = ymd(now);
  const out = { paid: 0, reminded: 0, overdue: 0 };

  // Positive statements whose pay link failed to register earlier.
  const { data: unissued } = await admin.from("commission_statements").select("*").eq("status", "open").gt("total_due_cents", 0).limit(100);
  for (const s of (unissued ?? []) as StatementRow[]) {
    try {
      await issueStatement(admin, s, today);
    } catch (err) {
      console.error("[statements] retry issue failed", s.id, err);
    }
  }

  const { data: due } = await admin.from("commission_statements").select("*").in("status", ["sent", "overdue"]).limit(500);
  for (const s of (due ?? []) as StatementRow[]) {
    try {
      if (s.paylink_request_id || s.paylink_order_id) {
        const check = await revampPaylink.checkPayment({ requestId: s.paylink_request_id, orderId: s.paylink_order_id });
        if (check.approved) {
          await markStatementPaid(admin, s.id, { orderId: check.orderId ?? null, now });
          out.paid++;
          continue;
        }
      }
      if (s.status === "sent" && s.due_date && today > s.due_date) {
        await admin.from("commission_statements").update({ status: "overdue" }).eq("id", s.id).eq("status", "sent");
        const paused = await setPaymentAccountPaused(admin, s.operator_id, true, OVERDUE_PAUSE_REASON);
        const to = await operatorEmail(admin, s.operator_id);
        if (paused && to) await sendDirectPaymentsPaused(to, emailInfo(s));
        out.overdue++;
      } else if (s.status === "sent" && s.due_date && !s.reminded_at && today >= addDays(s.due_date, -REMINDER_DAYS_BEFORE)) {
        await admin.from("commission_statements").update({ reminded_at: now.toISOString() }).eq("id", s.id);
        const to = await operatorEmail(admin, s.operator_id);
        if (to) await sendCommissionStatementReminder(to, emailInfo(s));
        out.reminded++;
      }
    } catch (err) {
      console.error("[statements] reconcile failed", s.id, err);
    }
  }
  return out;
}

/**
 * Mark a statement paid (PayLink-verified, or by an admin with a reference —
 * also how a "credit" is marked paid out). Resumes direct payments if they
 * were paused for an overdue statement and none remain overdue.
 */
export async function markStatementPaid(
  admin: SupabaseClient,
  id: string,
  opts: { orderId?: string | null; reference?: string | null; now?: Date } = {},
): Promise<boolean> {
  const now = opts.now ?? new Date();
  const { data } = await admin
    .from("commission_statements")
    .update({
      status: "paid",
      paid_at: now.toISOString(),
      ...(opts.orderId ? { paylink_order_id: opts.orderId } : {}),
      ...(opts.reference ? { reference: opts.reference } : {}),
    })
    .eq("id", id)
    .in("status", ["open", "sent", "overdue", "credit"])
    .select("operator_id")
    .maybeSingle();
  if (!data) return false;
  await resumeIfSettled(admin, data.operator_id as string);
  return true;
}

/** Admin: void a statement — its charges are forgiven (rows voided too). */
export async function voidStatement(admin: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await admin
    .from("commission_statements")
    .update({ status: "void" })
    .eq("id", id)
    .in("status", ["open", "sent", "overdue", "credit"])
    .select("operator_id")
    .maybeSingle();
  if (!data) return false;
  await admin.from("direct_payment_ledger").update({ status: "void" }).eq("statement_id", id);
  await resumeIfSettled(admin, data.operator_id as string);
  return true;
}

async function resumeIfSettled(admin: SupabaseClient, operatorId: string): Promise<void> {
  const { count } = await admin
    .from("commission_statements")
    .select("id", { count: "exact", head: true })
    .eq("operator_id", operatorId)
    .eq("status", "overdue");
  if ((count ?? 0) > 0) return;
  const { data: acc } = await admin.from("operator_payment_accounts").select("status, paused_reason").eq("operator_id", operatorId).maybeSingle();
  if (acc?.status === "paused" && acc.paused_reason === OVERDUE_PAUSE_REASON) {
    await setPaymentAccountPaused(admin, operatorId, false);
  }
}

/** Everything the cron runs. Safe before 0094 (each step no-ops on errors). */
export async function runCommissionStatements(admin: SupabaseClient, now = new Date()) {
  const built = await buildMonthlyStatements(admin, now).catch(() => 0);
  const rec = await reconcileStatements(admin, now).catch(() => ({ paid: 0, reminded: 0, overdue: 0 }));
  const purged = await purgeDisconnectedCredentials(admin).catch(() => 0);
  return { built, ...rec, purged };
}

/** Operator returned from paying a statement: verify their sent/overdue ones now. */
export async function confirmOperatorStatements(admin: SupabaseClient, operatorId: string): Promise<number> {
  const { data } = await admin.from("commission_statements").select("*").eq("operator_id", operatorId).in("status", ["sent", "overdue"]).limit(24);
  let paid = 0;
  for (const s of (data ?? []) as StatementRow[]) {
    if (!s.paylink_request_id && !s.paylink_order_id) continue;
    try {
      const check = await revampPaylink.checkPayment({ requestId: s.paylink_request_id, orderId: s.paylink_order_id });
      if (check.approved && (await markStatementPaid(admin, s.id, { orderId: check.orderId ?? null }))) paid++;
    } catch {
      /* the cron retries */
    }
  }
  return paid;
}
