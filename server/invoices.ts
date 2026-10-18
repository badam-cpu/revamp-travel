/**
 * Guest invoices (migration 0108) — server side. Reads the booking with the
 * service role, decides the seller (whoever got paid), takes the invoice
 * number, saves the sender's edits and emails the guest. The invoice itself is
 * built and drawn by shared/invoice.ts, the same code the editor preview and
 * the guest's /invoice/:token page use.
 *
 * Amounts are never taken from the client: every build starts from the
 * booking row, so a sent invoice always matches what was charged. The public
 * page re-builds from the live booking (with the saved number and edits), so
 * an invoice sent as "Balance due" shows "Paid" once the guest pays.
 */
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildInvoice,
  formatInvoiceNumber,
  invoiceHtml,
  invoiceMoney,
  invoicePrefix,
  isInvoiceable,
  REVAMP_SELLER_DEFAULT,
  type InvoiceBookingFacts,
  type InvoiceContext,
  type InvoiceEdits,
  type InvoiceIssuerKind,
  type InvoiceModel,
  type InvoiceParty,
} from "../shared/invoice.js";
import { roomUnitLabel } from "../shared/rooms.js";
import { sendInvoiceEmail } from "./email.js";
import { contactFor } from "./guestContacts.js";

const SITE = () => (process.env.URL || "https://revampvacations.com").replace(/\/+$/, "");
export const invoiceLinkFor = (token: string) => `${SITE()}/invoice/${token}`;

const yerevanToday = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);

interface SettingsRow {
  issuer: string;
  legal_name: string | null;
  tax_id: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  bank_details: string | null;
  number_prefix: string | null;
}

export interface InvoiceSource {
  facts: InvoiceBookingFacts;
  operatorId: string;
  issuerKind: InvoiceIssuerKind;
  issuerKey: string;
  operatorName: string;
  operatorLogoUrl: string | null;
  operatorEmail: string | null;
  seller: InvoiceParty;
  numberPrefix: string;
}

export interface SavedInvoice {
  id: string;
  issuer: string;
  number: string;
  token: string;
  edits: InvoiceEdits;
  sent_to: string | null;
  sent_at: string | null;
  send_count: number;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Everything needed to build a booking's invoice, or null if it doesn't exist. */
export async function loadInvoiceSource(admin: SupabaseClient, bookingId: string): Promise<InvoiceSource | null> {
  // select("*") so columns from later migrations (promo, credit, 0094 owner) are read when present.
  const { data, error } = await admin.from("bookings").select("*, listings!inner(operator_id, title, type, city, region)").eq("id", bookingId).maybeSingle();
  if (error || !data) return null;
  const b = data as Row & { listings: { operator_id: string; title: string; type: string; city: string; region: string } };
  const L = b.listings;

  // Side lookups — each failure-tolerant.
  let promoCode: string | null = null;
  if (str(b.promo_code_id)) {
    const { data: p } = await admin.from("promo_codes").select("code").eq("id", b.promo_code_id as string).maybeSingle();
    promoCode = (p as { code?: string } | null)?.code ?? null;
  }
  let roomLabel: string | null = null;
  if (str(b.room_type_id)) {
    const { data: r } = await admin.from("bookings").select("room_types(name), room_units(name)").eq("id", bookingId).maybeSingle();
    const rr = r as unknown as { room_types: { name?: string } | null; room_units: { name?: string } | null } | null;
    roomLabel = [rr?.room_types?.name, rr?.room_units?.name ? roomUnitLabel(rr.room_units.name) : ""].filter(Boolean).join(" · ") || null;
  }
  const { data: prof } = await admin.from("profiles").select("display_name, business_name, logo_url").eq("id", L.operator_id).maybeSingle();
  const pr = (prof ?? {}) as { display_name?: string | null; business_name?: string | null; logo_url?: string | null };
  const operatorName = pr.business_name || pr.display_name || "Your host";
  let operatorEmail: string | null = null;
  try {
    const { data: u } = await admin.auth.admin.getUserById(L.operator_id);
    operatorEmail = u?.user?.email ?? null;
  } catch {
    /* no email — the invoice simply leaves it out */
  }

  const provider = str(b.provider);
  // Whoever got paid issues the invoice: the operator for offline bookings and
  // their own PayLink account (0094), otherwise Revamp.
  const issuerKind: InvoiceIssuerKind = provider === "direct" || str(b.paylink_account_owner) ? "operator" : "revamp";
  const issuerKey = issuerKind === "revamp" ? "revamp" : L.operator_id;

  const { data: s } = await admin.from("invoice_settings").select("issuer, legal_name, tax_id, address, email, phone, bank_details, number_prefix").eq("issuer", issuerKey).maybeSingle();
  const set = (s ?? null) as SettingsRow | null;
  const seller: InvoiceParty =
    issuerKind === "revamp"
      ? {
          ...REVAMP_SELLER_DEFAULT,
          name: set?.legal_name || REVAMP_SELLER_DEFAULT.name,
          taxId: set?.tax_id || undefined,
          address: set?.address || REVAMP_SELLER_DEFAULT.address,
          email: set?.email || REVAMP_SELLER_DEFAULT.email,
          phone: set?.phone || undefined,
          bankDetails: set?.bank_details || undefined,
        }
      : {
          name: set?.legal_name || operatorName,
          taxId: set?.tax_id || undefined,
          address: set?.address || undefined,
          email: set?.email || operatorEmail || undefined,
          phone: set?.phone || undefined,
          bankDetails: set?.bank_details || undefined,
        };

  const addons = Array.isArray(b.addons)
    ? (b.addons as { id?: string; name?: string; qty?: number; amountCents?: number; onRequest?: boolean }[])
        .filter((a) => a && a.name)
        .map((a, i) => ({ id: String(a.id ?? i), name: String(a.name), qty: Math.max(1, num(a.qty)), amountCents: num(a.amountCents), onRequest: !!a.onRequest }))
    : [];

  const facts: InvoiceBookingFacts = {
    id: String(b.id),
    listingTitle: L.title,
    listingType: L.type,
    city: L.city,
    region: L.region,
    startDate: String(b.start_date),
    endDate: String(b.end_date),
    startsAt: str(b.starts_at),
    guests: num(b.guests) || 1,
    roomLabel,
    baseCents: typeof b.base_cents === "number" ? b.base_cents : null,
    taxCents: typeof b.tax_cents === "number" ? b.tax_cents : null,
    addonsCents: typeof b.addons_cents === "number" ? b.addons_cents : null,
    addons,
    promoDiscountCents: num(b.promo_discount_cents),
    promoCode,
    amountCents: num(b.amount_cents),
    currency: str(b.currency) || "AMD",
    giftAppliedCents: num(b.gift_applied_cents),
    creditAppliedCents: num(b.credit_applied_cents),
    status: String(b.status),
    provider,
    paymentStatus: str(b.payment_status),
    paidAt: str(b.paid_at),
    guestName: str(b.guest_name),
    guestEmail: str(b.guest_email),
  };

  // An account guest's name/email live on their profile/auth user.
  if ((!facts.guestName || !facts.guestEmail) && str(b.traveler_id)) {
    const { data: tp } = await admin.from("profiles").select("display_name").eq("id", b.traveler_id as string).maybeSingle();
    facts.guestName ||= (tp as { display_name?: string } | null)?.display_name ?? null;
    if (!facts.guestEmail) {
      try {
        const { data: tu } = await admin.auth.admin.getUserById(b.traveler_id as string);
        facts.guestEmail = tu?.user?.email ?? null;
      } catch {
        /* leave empty — the sender types it */
      }
    }
  }

  return {
    facts,
    operatorId: L.operator_id,
    issuerKind,
    issuerKey,
    operatorName,
    operatorLogoUrl: pr.logo_url ?? null,
    operatorEmail,
    seller,
    numberPrefix: invoicePrefix(issuerKind, set?.number_prefix),
  };
}

export async function savedInvoice(admin: SupabaseClient, bookingId: string): Promise<SavedInvoice | null> {
  const { data } = await admin.from("invoices").select("id, issuer, number, token, edits, sent_to, sent_at, send_count").eq("booking_id", bookingId).maybeSingle();
  return (data as SavedInvoice | null) ?? null;
}

export function invoiceContext(src: InvoiceSource, number: string | null): InvoiceContext {
  return { issuerKind: src.issuerKind, seller: src.seller, operatorName: src.operatorName, operatorLogoUrl: src.operatorLogoUrl, number, today: yerevanToday() };
}

/** Owner of the listing, or an admin. */
export async function canManageInvoice(admin: SupabaseClient, src: InvoiceSource, userId: string): Promise<boolean> {
  if (src.operatorId === userId) return true;
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  return (data as { role?: string } | null)?.role === "admin";
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export type SaveInvoiceResult =
  | { ok: true; number: string; url: string; sent: boolean; sentTo: string | null; model: InvoiceModel }
  | { ok: false; status: number; error: string };

/**
 * Saves the invoice (taking a number the first time) and, when `send` is set,
 * emails it. Seller details are saved as the operator's defaults on request.
 */
export async function saveInvoice(
  admin: SupabaseClient,
  src: InvoiceSource,
  userId: string,
  edits: InvoiceEdits,
  opts: { send: boolean; saveSellerDefaults: boolean },
): Promise<SaveInvoiceResult> {
  if (!isInvoiceable(src.facts.status)) return { ok: false, status: 400, error: "Invoices can be made for confirmed bookings and bookings awaiting payment." };
  // Empty "Send to" → the guest's email on file; for an unpaid booking that's
  // held privately (0113) and used without ever showing it to the host.
  const sendTo = (edits.sendTo ?? "").trim() || src.facts.guestEmail || (await contactFor(admin, { id: src.facts.id })).email || "";
  if (opts.send && !isEmail(sendTo)) return { ok: false, status: 400, error: "Add the guest's email address to send the invoice." };

  // Only an operator seller keeps seller edits. A held address is never stored on the invoice the host can read.
  const typed = (edits.sendTo ?? "").trim() || src.facts.guestEmail || "";
  // What the host may see as the recipient (history, "sent to", the toast).
  const shownTo = typed || "the guest's email on file";
  const clean: InvoiceEdits = { ...edits, sendTo: typed, seller: src.issuerKind === "operator" ? edits.seller : undefined };

  if (opts.saveSellerDefaults && src.issuerKind === "operator" && clean.seller) {
    const s = clean.seller;
    const { error } = await admin.from("invoice_settings").upsert(
      {
        issuer: src.issuerKey,
        legal_name: s.name?.trim() || null,
        tax_id: s.taxId?.trim() || null,
        address: s.address?.trim() || null,
        email: s.email?.trim() || null,
        phone: s.phone?.trim() || null,
        bank_details: s.bankDetails?.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "issuer" },
    );
    if (error) console.error("[invoice] save seller defaults", error.message);
  }

  const takeNumber = async (): Promise<string | null> => {
    const { data: n, error: nErr } = await admin.rpc("next_invoice_number", { p_issuer: src.issuerKey });
    if (nErr || typeof n !== "number") {
      console.error("[invoice] number", nErr?.message);
      return null;
    }
    return formatInvoiceNumber(src.numberPrefix, Number(yerevanToday().slice(0, 4)), n);
  };
  const unavailable = { ok: false as const, status: 503, error: "Invoices aren't available yet. Please try again later." };

  let inv = await savedInvoice(admin, src.facts.id);
  // The seller changed since it was numbered (e.g. an offline booking later
  // paid through Revamp): it gets a number in the new seller's series.
  if (inv && inv.issuer !== src.issuerKey) {
    const number = await takeNumber();
    if (!number) return unavailable;
    await admin.from("invoices").update({ issuer: src.issuerKey, number }).eq("id", inv.id);
    inv = { ...inv, issuer: src.issuerKey, number };
  }
  if (!inv) {
    const number = await takeNumber();
    if (!number) return unavailable;
    const token = crypto.randomBytes(18).toString("base64url");
    const model = buildInvoice(src.facts, invoiceContext(src, number), clean);
    const { data: created, error: insErr } = await admin
      .from("invoices")
      .insert({ booking_id: src.facts.id, issuer: src.issuerKey, number, token, edits: clean, total_cents: model.totalCents, currency: model.currency, created_by: userId })
      .select("id, issuer, number, token, edits, sent_to, sent_at, send_count")
      .single();
    if (insErr || !created) {
      // Someone saved it at the same moment — use theirs.
      inv = await savedInvoice(admin, src.facts.id);
      if (!inv) {
        console.error("[invoice] insert", insErr?.message);
        return { ok: false, status: 500, error: "Couldn't save the invoice. Please try again." };
      }
    } else {
      inv = created as SavedInvoice;
    }
  }

  const model = buildInvoice(src.facts, invoiceContext(src, inv.number), clean);
  await admin.from("invoices").update({ edits: clean, total_cents: model.totalCents, currency: model.currency, updated_at: new Date().toISOString() }).eq("id", inv.id);

  let sent = false;
  if (opts.send) {
    const r = await sendInvoiceEmail(sendTo, {
      number: inv.number,
      sellerName: model.seller.name,
      listingTitle: src.facts.listingTitle,
      totalLabel: invoiceMoney(model.status === "due" ? model.balanceCents : model.totalCents, model.currency),
      due: model.status === "due",
      invoiceHtml: invoiceHtml(model, { brandHeader: false }),
      url: invoiceLinkFor(inv.token),
      replyTo: src.issuerKind === "operator" ? model.seller.email || src.operatorEmail || undefined : undefined,
    });
    sent = r.sent;
    await logEvent(admin, src.facts.id, sent ? "invoice_sent" : "email_failed", sent ? `${inv.number} to ${shownTo}` : `Invoice ${inv.number} to ${shownTo}`);
    if (sent) {
      await admin
        .from("invoices")
        .update({ sent_to: shownTo, sent_at: new Date().toISOString(), send_count: (inv.send_count ?? 0) + 1 })
        .eq("id", inv.id);
    } else {
      return { ok: false, status: 502, error: "The invoice is saved, but the email couldn't be sent. Copy the link to share it, or try again." };
    }
  }

  return { ok: true, number: inv.number, url: invoiceLinkFor(inv.token), sent, sentTo: sent ? shownTo : inv.sent_to, model };
}

async function logEvent(admin: SupabaseClient, bookingId: string, type: string, detail: string) {
  try {
    await admin.from("booking_events").insert({ booking_id: bookingId, type, detail });
  } catch {
    /* the log is best-effort */
  }
}

/** The guest's invoice page: rebuilt from the live booking with the saved number and edits. */
export async function invoiceForToken(admin: SupabaseClient, token: string): Promise<InvoiceModel | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const { data } = await admin.from("invoices").select("booking_id, number, edits").eq("token", token).maybeSingle();
  const row = data as { booking_id: string; number: string; edits: InvoiceEdits } | null;
  if (!row) return null;
  const src = await loadInvoiceSource(admin, row.booking_id);
  if (!src) return null;
  return buildInvoice(src.facts, invoiceContext(src, row.number), row.edits ?? {});
}
