/**
 * Operator payout logic shared by the server (creates payouts on booking
 * confirm) and the client (displays them). Revamp is merchant of record; each
 * confirmed booking becomes one payout to the operator, scheduled by type:
 *   stay              → due the day after check-in
 *   tour / experience → monthly (due the 1st of the month after the service date)
 *
 * Stored status is pending | paid | cancelled. The display state adds "unpaid"
 * (pending AND due) so operators see paid / unpaid / pending without a cron.
 */
import type { ListingType } from "./listings.js";
import { addDaysIso } from "./bookings.js";

export type PayoutStatus = "pending" | "paid" | "cancelled";
export type PayoutState = "pending" | "unpaid" | "paid" | "cancelled";

/** Default platform commission (%). 0 = operator gets 100%. Server may override via PLATFORM_FEE_PERCENT. */
export const DEFAULT_PLATFORM_FEE_PERCENT = 0;

export interface Payout {
  id: string;
  bookingId: string;
  operatorId: string;
  listingId: string | null;
  listingTitle: string;
  listingType: ListingType;
  grossCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  dueDate: string;
  status: PayoutStatus;
  paidAt: string | null;
  reference: string | null;
  createdAt: string;
}

/** First day of the month AFTER the given YYYY-MM-DD, as YYYY-MM-DD (UTC). */
export function firstOfNextMonthIso(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/** When a booking's payout is due, by listing type + service (start) date. */
export function payoutDueDate(type: ListingType, startDate: string): string {
  // Stays pay out the day after check-in; tours/experiences pay out monthly.
  return type === "stay" ? addDaysIso(startDate, 1) : firstOfNextMonthIso(startDate);
}

/** Platform fee + operator net for a gross booking amount. */
export function splitPayout(grossCents: number, feePercent = DEFAULT_PLATFORM_FEE_PERCENT): { feeCents: number; netCents: number } {
  const pct = Math.min(100, Math.max(0, feePercent));
  const feeCents = Math.round(grossCents * (pct / 100));
  return { feeCents, netCents: Math.max(0, grossCents - feeCents) };
}

/**
 * Display state: paid/cancelled as stored; a pending payout becomes "unpaid"
 * (ready to be paid) once its due date has arrived, else "pending" (scheduled).
 */
export function payoutState(status: PayoutStatus, dueDate: string, todayIso: string): PayoutState {
  if (status === "paid") return "paid";
  if (status === "cancelled") return "cancelled";
  return dueDate <= todayIso ? "unpaid" : "pending";
}

export const PAYOUT_STATE_LABEL: Record<PayoutState, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  pending: "Pending",
  cancelled: "Cancelled",
};
