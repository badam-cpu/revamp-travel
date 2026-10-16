/**
 * Guest invoices (migration 0108). ONE builder and ONE renderer, shared by the
 * operator's editor preview, the invoice email and the guest's private
 * invoice page (/invoice/:token) — so all three always look the same.
 *
 * Amounts are never editable: they come from the booking row (base after any
 * promo, tax, add-ons, gift card / Revamp credit, what's been paid). The
 * sender edits only words — bill-to, dates, line descriptions, notes and, when
 * they are the seller, their own seller details.
 *
 * The seller is whoever got paid: Revamp Hospitality LLC when the guest paid
 * through Revamp, the operator when they paid the operator directly (their
 * own PayLink account, or an offline booking).
 */
import { TAX_PERCENT } from "./bookings.js";
import { formatSlotTime } from "./sessions.js";

export type InvoiceIssuerKind = "revamp" | "operator";
export type InvoiceStatus = "paid" | "due" | "cancelled";

export interface InvoiceParty {
  name: string;
  company?: string;
  taxId?: string;
  address?: string;
  email?: string;
  phone?: string;
  bankDetails?: string;
  website?: string;
}

/** Everything the invoice needs from the booking (the server reads it). */
export interface InvoiceBookingFacts {
  id: string;
  listingTitle: string;
  listingType: string;
  city: string;
  region: string;
  startDate: string;
  endDate: string;
  startsAt: string | null;
  guests: number;
  roomLabel: string | null;
  baseCents: number | null;
  taxCents: number | null;
  addonsCents: number | null;
  addons: { id: string; name: string; qty: number; amountCents: number; onRequest?: boolean }[];
  promoDiscountCents: number;
  promoCode: string | null;
  amountCents: number;
  currency: string;
  giftAppliedCents: number;
  creditAppliedCents: number;
  status: string;
  provider: string | null;
  paymentStatus: string | null;
  paidAt: string | null;
  guestName: string | null;
  guestEmail: string | null;
}

/** What the sender may change. Amounts are deliberately absent. */
export interface InvoiceEdits {
  sendTo?: string;
  billTo?: { name?: string; company?: string; taxId?: string; address?: string };
  issuedOn?: string;
  dueOn?: string | null;
  notes?: string;
  lines?: Record<string, string>;
  /** Only honoured when the operator is the seller. */
  seller?: { name?: string; taxId?: string; address?: string; email?: string; phone?: string; bankDetails?: string };
}

export interface InvoiceContext {
  issuerKind: InvoiceIssuerKind;
  /** Saved/default seller details (edits for an operator seller go on top). */
  seller: InvoiceParty;
  /** The operator's business name — shown as provider (Revamp seller) or as the seller. */
  operatorName: string;
  operatorLogoUrl?: string | null;
  number: string | null;
  today: string;
}

export interface InvoiceLine {
  key: string;
  description: string;
  amountCents: number;
  onRequest?: boolean;
}

export interface InvoiceModel {
  number: string | null;
  status: InvoiceStatus;
  issuedOn: string;
  dueOn: string | null;
  paidOn: string | null;
  currency: string;
  issuerKind: InvoiceIssuerKind;
  seller: InvoiceParty;
  billTo: InvoiceParty;
  logoUrl: string | null;
  /** "Service provided by …" (Revamp seller) or "Booked on Revamp Vacations" (operator seller). */
  providerLine: string;
  bookingRef: string;
  reservation: { title: string; place: string; when: string; who: string };
  lines: InvoiceLine[];
  subtotalCents: number;
  taxLabel: string;
  taxCents: number;
  totalCents: number;
  payments: { label: string; amountCents: number }[];
  balanceCents: number;
  notes: string;
  paymentMethod: string;
}

export const REVAMP_SELLER_DEFAULT: InvoiceParty = {
  name: "Revamp Hospitality LLC",
  address: "Yerevan, Armenia",
  email: "hello@revampvacations.com",
  website: "revampvacations.com",
};

/** Statuses an invoice can be created for. */
export const INVOICEABLE_STATUSES = ["confirmed", "completed", "pending_payment", "awaiting_payment"] as const;
export function isInvoiceable(status: string): boolean {
  return (INVOICEABLE_STATUSES as readonly string[]).includes(status);
}

export const INVOICE_LIMITS = { short: 120, line: 200, address: 300, notes: 1000, bank: 400 } as const;

export function bookingRef(id: string): string {
  return `#${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function formatInvoiceNumber(prefix: string, year: number, n: number): string {
  return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
}

/** "RV" for Revamp, the operator's saved prefix (letters/digits, ≤8) or "INV". */
export function invoicePrefix(kind: InvoiceIssuerKind, saved?: string | null): string {
  if (kind === "revamp") return "RV";
  const clean = (saved ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return clean || "INV";
}

export function invoiceMoney(cents: number, currency: string): string {
  const neg = cents < 0;
  const abs = Math.abs(cents) / 100;
  const body =
    currency === "AMD"
      ? `AMD ${Math.round(abs).toLocaleString("en-US")}`
      : currency === "USD"
        ? `$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `${currency} ${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return neg ? `−${body}` : body;
}

export function invoiceDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = iso.length > 10 ? new Date(iso) : new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: iso.length > 10 ? "Asia/Yerevan" : "UTC" });
}

/** "14–17 Nov 2026", "28 Nov – 2 Dec 2026", or two full dates across years. */
export function invoiceDateRange(a: string, b: string): string {
  const [ya, ma] = a.split("-");
  const [yb, mb] = b.split("-");
  const day = (iso: string) => String(Number(iso.slice(8, 10)));
  const mon = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  if (ya !== yb) return `${invoiceDate(a)} – ${invoiceDate(b)}`;
  if (ma !== mb) return `${day(a)} ${mon(a)} – ${day(b)} ${mon(b)} ${yb}`;
  return `${day(a)}–${day(b)} ${mon(b)} ${yb}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nightsBetween(a: string, b: string): number {
  return Math.max(1, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function isStay(type: string) {
  return type === "stay";
}

/** Default text of each line, before the sender's edits. */
export function defaultLineDescription(f: InvoiceBookingFacts, key: string): string {
  if (key === "main") {
    if (isStay(f.listingType)) {
      const n = nightsBetween(f.startDate, f.endDate);
      const room = f.roomLabel ? ` · ${f.roomLabel}` : "";
      return `${f.listingTitle}${room} — ${plural(n, "night")}, ${invoiceDateRange(f.startDate, f.endDate)}`;
    }
    const time = f.startsAt ? `, ${formatSlotTime(f.startsAt)}` : "";
    return `${f.listingTitle} — ${invoiceDate(f.startDate)}${time}, ${plural(f.guests, "guest")}`;
  }
  if (key === "promo") return f.promoCode ? `Promo code ${f.promoCode}` : "Discount";
  if (key.startsWith("addon:")) {
    const a = f.addons.find((x) => `addon:${x.id}` === key);
    if (!a) return "";
    return `${a.name}${a.qty > 1 ? ` × ${a.qty}` : ""}`;
  }
  return "";
}

/** Was the booking paid in full (so nothing is due)? */
function isPaid(f: InvoiceBookingFacts): boolean {
  if (f.status === "confirmed" || f.status === "completed") {
    return f.provider === "direct" ? f.paymentStatus === "paid" : true;
  }
  return false;
}

function paymentMethod(f: InvoiceBookingFacts, paid: boolean): string {
  if (f.provider === "direct") return paid ? "Paid to host" : "Pay the host";
  if (f.provider === "gift") return "Gift card";
  if (f.provider === "credit") return "Revamp credit";
  return "Card (PayLink)";
}

/** Suggested due date for an unpaid invoice: a week from today, or the start date if sooner (never before today). */
export function defaultDueOn(f: InvoiceBookingFacts, today: string): string {
  const week = addDays(today, 7);
  const byStart = f.startDate < week ? f.startDate : week;
  return byStart < today ? today : byStart;
}

const clip = (s: string | undefined | null, max: number) => (s ?? "").trim().slice(0, max);

export function buildInvoice(f: InvoiceBookingFacts, ctx: InvoiceContext, edits: InvoiceEdits = {}): InvoiceModel {
  const tax = Math.max(0, f.taxCents ?? 0);
  const addonsTotal = Math.max(0, f.addonsCents ?? 0);
  // Base after promo; older rows without base_cents derive it from the total.
  const base = f.baseCents ?? Math.max(0, f.amountCents - tax - addonsTotal);
  const promo = Math.max(0, f.promoDiscountCents || 0);
  const edited = edits.lines ?? {};
  const line = (key: string, amountCents: number, onRequest?: boolean): InvoiceLine => ({
    key,
    amountCents,
    onRequest,
    description: clip(edited[key], INVOICE_LIMITS.line) || defaultLineDescription(f, key),
  });

  const lines: InvoiceLine[] = [line("main", base + promo)];
  if (promo > 0) lines.push(line("promo", -promo));
  for (const a of f.addons) lines.push(line(`addon:${a.id}`, a.onRequest ? 0 : a.amountCents, a.onRequest));
  const subtotal = lines.reduce((s, l) => s + l.amountCents, 0);
  const total = f.amountCents;

  const cancelled = f.status === "cancelled" || f.status === "refunded";
  const paid = isPaid(f);
  const gift = Math.max(0, f.giftAppliedCents || 0);
  const credit = Math.max(0, f.creditAppliedCents || 0);
  const payments: { label: string; amountCents: number }[] = [];
  if (gift) payments.push({ label: "Gift card", amountCents: -gift });
  if (credit) payments.push({ label: "Revamp credit", amountCents: -credit });
  const rest = Math.max(0, total - gift - credit);
  if (paid && rest > 0) payments.push({ label: f.provider === "direct" ? "Payment received" : "Paid by card", amountCents: -rest });
  const balance = cancelled || paid ? 0 : rest;
  const status: InvoiceStatus = cancelled ? "cancelled" : balance > 0 ? "due" : "paid";

  // Seller: an operator seller may edit their own details; Revamp's are fixed.
  const se = ctx.issuerKind === "operator" ? edits.seller ?? {} : {};
  const pick = (v: string | undefined, fallback: string | undefined, max: number) => (v !== undefined ? clip(v, max) : fallback ?? "");
  const seller: InvoiceParty = {
    ...ctx.seller,
    name: pick(se.name, ctx.seller.name, INVOICE_LIMITS.short) || ctx.operatorName || "Host",
    taxId: pick(se.taxId, ctx.seller.taxId, INVOICE_LIMITS.short),
    address: pick(se.address, ctx.seller.address, INVOICE_LIMITS.address),
    email: pick(se.email, ctx.seller.email, INVOICE_LIMITS.short),
    phone: pick(se.phone, ctx.seller.phone, INVOICE_LIMITS.short),
    bankDetails: pick(se.bankDetails, ctx.seller.bankDetails, INVOICE_LIMITS.bank),
  };

  const bt = edits.billTo ?? {};
  const billTo: InvoiceParty = {
    name: clip(bt.name, INVOICE_LIMITS.short) || f.guestName || "Guest",
    company: clip(bt.company, INVOICE_LIMITS.short),
    taxId: clip(bt.taxId, INVOICE_LIMITS.short),
    address: clip(bt.address, INVOICE_LIMITS.address),
    email: clip(edits.sendTo, INVOICE_LIMITS.short) || f.guestEmail || "",
  };

  const issuedOn = /^\d{4}-\d{2}-\d{2}$/.test(edits.issuedOn ?? "") ? (edits.issuedOn as string) : ctx.today;
  const dueOn = status === "due" ? (/^\d{4}-\d{2}-\d{2}$/.test(edits.dueOn ?? "") ? (edits.dueOn as string) : defaultDueOn(f, ctx.today)) : null;

  const place = [f.city, f.region && f.region !== f.city ? f.region : ""].filter(Boolean).join(", ");
  const when = isStay(f.listingType)
    ? `Check-in ${invoiceDate(f.startDate)} → check-out ${invoiceDate(f.endDate)} · ${plural(nightsBetween(f.startDate, f.endDate), "night")}`
    : `${invoiceDate(f.startDate)}${f.startsAt ? ` at ${formatSlotTime(f.startsAt)}` : ""}`;

  return {
    number: ctx.number,
    status,
    issuedOn,
    dueOn,
    paidOn: paid && f.paidAt ? f.paidAt : null,
    currency: f.currency || "AMD",
    issuerKind: ctx.issuerKind,
    seller,
    billTo,
    logoUrl: ctx.issuerKind === "operator" ? ctx.operatorLogoUrl ?? null : null,
    providerLine: ctx.issuerKind === "revamp" ? `Service provided by ${ctx.operatorName || "the host"} · booked on Revamp Vacations` : "Booked on Revamp Vacations · revampvacations.com",
    bookingRef: bookingRef(f.id),
    reservation: { title: f.listingTitle, place, when, who: `${plural(f.guests, "guest")}${f.roomLabel ? ` · ${f.roomLabel}` : ""}` },
    lines,
    subtotalCents: subtotal,
    taxLabel: `Tax (${TAX_PERCENT}%)`,
    taxCents: tax,
    totalCents: total,
    payments,
    balanceCents: balance,
    notes: clip(edits.notes, INVOICE_LIMITS.notes),
    paymentMethod: paymentMethod(f, paid),
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────
// Table-based with inline styles so the same HTML works in email clients
// (Gmail/Outlook strip <style>) and on the web page / print-to-PDF.

const C = { ink: "#212121", soft: "#6B655C", line: "#E4DED3", fill: "#F6F3EC", orange: "#F15822" };
const FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
const br = (s: string) => esc(s).replace(/\r?\n/g, "<br />");

const STATUS_PILL: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
  paid: { label: "Paid", color: "#2F6B47", bg: "#E3F0E7" },
  due: { label: "Balance due", color: "#B83F0E", bg: "#FDEBE2" },
  cancelled: { label: "Cancelled", color: "#6B655C", bg: "#EFEAE0" },
};

function partyHtml(label: string, p: InvoiceParty): string {
  const rows = [
    `<div style="font-weight:700;font-size:14px;color:${C.ink};">${esc(p.name)}</div>`,
    p.company ? `<div>${esc(p.company)}</div>` : "",
    p.address ? `<div>${br(p.address)}</div>` : "",
    p.taxId ? `<div>Tax ID: ${esc(p.taxId)}</div>` : "",
    p.email ? `<div>${esc(p.email)}</div>` : "",
    p.phone ? `<div>${esc(p.phone)}</div>` : "",
    p.website ? `<div>${esc(p.website)}</div>` : "",
  ].join("");
  return `<div style="font-size:11px;font-weight:700;color:${C.soft};margin:0 0 6px;">${esc(label)}</div><div style="font-size:13px;line-height:1.55;color:${C.soft};overflow-wrap:break-word;">${rows}</div>`;
}

/**
 * The invoice as HTML. `brandHeader` (page and print) shows the wordmark/logo
 * row and puts From / Bill to side by side; the email turns it off — its frame
 * already has the wordmark, and on a phone the parties read better stacked.
 */
export function invoiceHtml(m: InvoiceModel, opts: { brandHeader?: boolean } = {}): string {
  const brandHeader = opts.brandHeader ?? true;
  const pill = STATUS_PILL[m.status];
  const money = (c: number) => esc(invoiceMoney(c, m.currency));
  const td = `padding:9px 0;border-bottom:1px solid ${C.line};font-size:13px;line-height:1.45;vertical-align:top;`;
  const num = `text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;padding-left:16px;`;

  const mark = m.logoUrl
    ? `<img src="${esc(m.logoUrl)}" alt="${esc(m.seller.name)}" height="40" style="display:block;height:40px;width:auto;max-width:180px;border:0;" />`
    : m.issuerKind === "operator"
      ? `<div style="font-weight:800;font-size:20px;letter-spacing:-.02em;color:${C.ink};">${esc(m.seller.name)}</div>`
      : `<div style="font-weight:800;font-size:26px;letter-spacing:-.03em;color:${C.ink};">revamp.</div>`;

  const numberLine = m.number ? `No. ${esc(m.number)}` : "Number given when sent";
  const pillHtml = `<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;color:${pill.color};background:${pill.bg};border-radius:999px;padding:4px 10px;">${pill.label}</span>`;
  // Page/print: brand mark left, title block right. Email (its frame already
  // carries the wordmark, and it's narrow): one left-aligned title block.
  const header = brandHeader
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  <tr>
    <td style="vertical-align:top;">${mark}</td>
    <td style="vertical-align:top;text-align:right;">
      <div style="font-weight:800;font-size:22px;letter-spacing:-.02em;color:${C.ink};">Invoice</div>
      <div style="font-size:13px;color:${C.soft};margin-top:2px;">${numberLine}</div>
      <div style="margin-top:8px;">${pillHtml}</div>
    </td>
  </tr>
</table>`
    : `<div><span style="font-weight:800;font-size:20px;letter-spacing:-.02em;color:${C.ink};vertical-align:middle;">Invoice</span>&nbsp;&nbsp;<span style="vertical-align:middle;">${pillHtml}</span></div>
<div style="font-size:13px;color:${C.soft};margin-top:4px;">${numberLine}</div>`;

  const parties = brandHeader
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:24px;">
  <tr>
    <td width="50%" style="vertical-align:top;padding-right:12px;">${partyHtml("From", m.seller)}</td>
    <td width="50%" style="vertical-align:top;padding-left:12px;">${partyHtml("Bill to", m.billTo)}</td>
  </tr>
</table>`
    : `<div style="margin-top:20px;">${partyHtml("Bill to", m.billTo)}</div><div style="margin-top:16px;">${partyHtml("From", m.seller)}</div>`;

  const meta: [string, string][] = [
    ["Issue date", invoiceDate(m.issuedOn)],
    m.status === "due" && m.dueOn ? ["Due date", invoiceDate(m.dueOn)] : m.paidOn ? ["Paid on", invoiceDate(m.paidOn)] : ["Status", pill.label],
    ["Booking ref", m.bookingRef],
    ["Payment", m.paymentMethod],
  ];
  const metaCell = ([k, v]: [string, string]) =>
    `<td width="50%" style="vertical-align:top;padding:10px 14px;"><div style="font-size:11px;color:${C.soft};">${esc(k)}</div><div style="font-size:13px;font-weight:600;color:${C.ink};margin-top:2px;">${esc(v)}</div></td>`;
  const metaHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:22px;background:${C.fill};border-radius:10px;">
  <tr>${metaCell(meta[0])}${metaCell(meta[1])}</tr>
  <tr>${metaCell(meta[2])}${metaCell(meta[3])}</tr>
</table>`;

  const reservation = `<div style="margin-top:22px;">
  <div style="font-size:15px;font-weight:700;color:${C.ink};">${esc(m.reservation.title)}</div>
  <div style="font-size:13px;line-height:1.55;color:${C.soft};margin-top:2px;">${esc([m.reservation.place, m.reservation.when, m.reservation.who].filter(Boolean).join(" · "))}</div>
</div>`;

  const lineRows = m.lines
    .map(
      (l) =>
        `<tr><td style="${td}color:${C.ink};overflow-wrap:anywhere;">${esc(l.description)}${l.onRequest ? `<div style="font-size:12px;color:${C.soft};">Price on request — not included in this total</div>` : ""}</td><td style="${td}${num}color:${l.amountCents < 0 ? C.soft : C.ink};">${l.onRequest ? "—" : money(l.amountCents)}</td></tr>`,
    )
    .join("");
  const linesHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:18px;">
  <tr>
    <td style="padding:0 0 8px;border-bottom:2px solid ${C.ink};font-size:11px;font-weight:700;color:${C.soft};">Description</td>
    <td style="padding:0 0 8px;border-bottom:2px solid ${C.ink};font-size:11px;font-weight:700;color:${C.soft};text-align:right;">Amount</td>
  </tr>
  ${lineRows}
</table>`;

  const sumRow = (label: string, value: string, strong = false, topRule = false) =>
    `<tr><td style="padding:${topRule ? "10px" : "5px"} 0 5px;white-space:nowrap;font-size:13px;color:${strong ? C.ink : C.soft};${strong ? "font-weight:700;" : ""}${topRule ? `border-top:1px solid ${C.ink};` : ""}">${esc(label)}</td><td style="padding:${topRule ? "10px" : "5px"} 0 5px;${num}font-size:${strong ? "15px" : "13px"};color:${C.ink};${strong ? "font-weight:800;" : ""}${topRule ? `border-top:1px solid ${C.ink};` : ""}">${value}</td></tr>`;
  const totals = [
    sumRow("Subtotal", money(m.subtotalCents)),
    m.taxCents ? sumRow(m.taxLabel, money(m.taxCents)) : "",
    sumRow("Total", money(m.totalCents), true, true),
    ...m.payments.map((p) => sumRow(p.label, money(p.amountCents))),
    m.status === "cancelled" ? "" : sumRow(m.status === "due" ? "Balance due" : "Balance", money(m.balanceCents), true, m.payments.length > 0),
  ].join("");
  const totalsTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${totals}</table>`;
  const totalsHtml = brandHeader
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:6px;">
  <tr><td width="40%"></td><td width="60%">${totalsTable}</td></tr>
</table>`
    : `<div style="margin-top:6px;">${totalsTable}</div>`;

  const bank =
    m.status === "due" && m.seller.bankDetails
      ? `<div style="margin-top:18px;font-size:13px;line-height:1.55;color:${C.ink};"><div style="font-size:11px;font-weight:700;color:${C.soft};margin-bottom:4px;">How to pay</div>${br(m.seller.bankDetails)}</div>`
      : "";
  const notes = m.notes
    ? `<div style="margin-top:18px;font-size:13px;line-height:1.55;color:${C.ink};"><div style="font-size:11px;font-weight:700;color:${C.soft};margin-bottom:4px;">Notes</div>${br(m.notes)}</div>`
    : "";
  const cancelledNote =
    m.status === "cancelled"
      ? `<div style="margin-top:18px;font-size:13px;color:${C.soft};">This booking was cancelled. Any refund is handled separately and shown on your refund confirmation.</div>`
      : "";

  // The email frame ends with the slogan already, so the email keeps only the provider line.
  const foot = !brandHeader
    ? `<div style="margin-top:22px;padding-top:12px;border-top:1px solid ${C.line};font-size:11px;line-height:1.6;color:${C.soft};">${esc(m.providerLine)}</div>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:28px;border-top:1px solid ${C.line};">
  <tr>
    <td style="vertical-align:top;padding-top:14px;">
      <div style="font-weight:800;font-size:13px;line-height:1.15;letter-spacing:-.01em;color:${C.ink};">Stay.<br /><span style="color:${C.orange};">Experience.</span><br />Repeat.</div>
    </td>
    <td style="vertical-align:top;padding-top:14px;text-align:right;font-size:11px;line-height:1.6;color:${C.soft};">
      ${esc(m.providerLine)}<br />Revamp Hospitality LLC · hello@revampvacations.com
    </td>
  </tr>
</table>`;

  return `<div style="font-family:${FONT};color:${C.ink};">${header}${parties}${metaHtml}${reservation}${linesHtml}${totalsHtml}${bank}${notes}${cancelledNote}${foot}</div>`;
}
