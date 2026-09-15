/**
 * Builds a Revamp-branded payout statement and opens it in a print window, so
 * an operator can "Save as PDF" (or print). Dependency-free — a self-contained
 * HTML document with the brand system (revamp. wordmark, #F15822 apricot,
 * #212121 basalt) that auto-invokes the browser's print dialog.
 */
import { payoutState, PAYOUT_STATE_LABEL, type Payout } from "@shared/payouts";

function money(cents: number, currency: string): string {
  const major = cents / 100;
  const n = major % 1 === 0 ? major.toLocaleString() : major.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `$${n}` : `${n} ${currency}`;
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function openPayoutStatement(opts: { operatorName: string; payouts: Payout[]; currency?: string }): void {
  const today = new Date().toISOString().slice(0, 10);
  const currency = opts.currency || opts.payouts[0]?.currency || "USD";
  const rows = [...opts.payouts].sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));

  const totals = { paid: 0, unpaid: 0, pending: 0 };
  for (const p of rows) {
    const st = payoutState(p.status, p.dueDate, today);
    if (st === "paid") totals.paid += p.netCents;
    else if (st === "unpaid") totals.unpaid += p.netCents;
    else if (st === "pending") totals.pending += p.netCents;
  }

  const rowsHtml = rows
    .map((p) => {
      const st = payoutState(p.status, p.dueDate, today);
      return `<tr>
        <td>${esc(fmtDate(p.dueDate))}</td>
        <td>${esc(p.listingTitle)}<span class="muted"> · ${esc(p.listingType)}</span></td>
        <td class="num">${esc(money(p.grossCents, p.currency))}</td>
        <td class="num">${p.feeCents ? "−" + esc(money(p.feeCents, p.currency)) : "—"}</td>
        <td class="num strong">${esc(money(p.netCents, p.currency))}</td>
        <td><span class="pill ${st}">${esc(PAYOUT_STATE_LABEL[st])}</span></td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Revamp Vacations — Payout statement</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Arial, sans-serif; color: #212121; margin: 0; padding: 40px; }
  .wm { font-weight: 800; font-size: 26px; letter-spacing: -.02em; }
  .wm span { color: #F15822; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #212121; padding-bottom: 16px; }
  .head h1 { font-size: 15px; text-transform: uppercase; letter-spacing: .14em; color: #857f76; margin: 6px 0 0; font-weight: 700; }
  .meta { text-align: right; font-size: 13px; color: #55514b; line-height: 1.6; }
  .meta strong { color: #212121; }
  .tiles { display: flex; gap: 12px; margin: 22px 0; }
  .tile { flex: 1; border: 1px solid #e4ded3; border-radius: 10px; padding: 14px 16px; }
  .tile .l { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #857f76; font-weight: 700; }
  .tile .v { font-size: 22px; font-weight: 800; margin-top: 4px; }
  .tile.unpaid { border-color: #F15822; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  th { text-align: left; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; color: #857f76; border-bottom: 2px solid #e4ded3; padding: 8px 10px; }
  td { padding: 10px; border-bottom: 1px solid #efeae0; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.strong { font-weight: 700; }
  .muted { color: #857f76; }
  .pill { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; padding: 3px 8px; border-radius: 999px; }
  .pill.paid { background: #dcefe3; color: #2f8f5b; }
  .pill.unpaid { background: #fbe7dd; color: #F15822; }
  .pill.pending { background: #efeae0; color: #55514b; }
  .pill.cancelled { background: #f6ded9; color: #c0392b; }
  .foot { margin-top: 28px; padding-top: 14px; border-top: 1px solid #e4ded3; font-size: 11px; color: #857f76; }
  @media print { body { padding: 0; } @page { margin: 18mm; } }
</style></head><body>
  <div class="head">
    <div>
      <div class="wm">revamp<span>.</span></div>
      <h1>Payout statement</h1>
    </div>
    <div class="meta">
      <strong>${esc(opts.operatorName)}</strong><br>
      Generated ${esc(fmtDate(today))}<br>
      ${rows.length} payout${rows.length === 1 ? "" : "s"}
    </div>
  </div>

  <div class="tiles">
    <div class="tile paid"><div class="l">Paid</div><div class="v">${esc(money(totals.paid, currency))}</div></div>
    <div class="tile unpaid"><div class="l">Unpaid (due)</div><div class="v">${esc(money(totals.unpaid, currency))}</div></div>
    <div class="tile pending"><div class="l">Pending</div><div class="v">${esc(money(totals.pending, currency))}</div></div>
  </div>

  <table>
    <thead><tr><th>Payout date</th><th>Listing</th><th class="num">Gross</th><th class="num">Fee</th><th class="num">Net</th><th>Status</th></tr></thead>
    <tbody>${rowsHtml || `<tr><td colspan="6" class="muted">No payouts in this view.</td></tr>`}</tbody>
  </table>

  <div class="foot">
    Revamp Vacations — Armenia's travel marketplace. Revamp is the merchant of record; payouts are made to operators separately per the schedule (stays: day after check-in; tours &amp; experiences: monthly). This statement is generated from your account and is for reference.
  </div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
</body></html>`;

  const win = window.open("", "_blank", "width=900,height=1100");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}
