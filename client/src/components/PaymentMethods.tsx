/**
 * "Secured payments" trust row — the card networks PayLink accepts (Visa,
 * Mastercard, ArCa, Apple Pay) shown as self-hosted inline SVG marks, plus a
 * "secured by PayLink" note. Shown in the footer and at checkout. Marks are
 * nominative "we accept" usage; keep this list in sync with what PayLink's hosted
 * checkout actually offers (Google Pay is deliberately excluded — not supported).
 */
import { cn } from "@/lib/utils";

function Chip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex h-7 w-11 items-center justify-center rounded-[6px] border border-basalt/12 bg-white"
    >
      {children}
    </span>
  );
}

function Visa() {
  return (
    <svg viewBox="0 0 40 16" className="h-3.5 w-auto" aria-hidden="true">
      <text x="20" y="13" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="15" fontStyle="italic" fontWeight="800" letterSpacing="-0.5" fill="#1434CB">VISA</text>
    </svg>
  );
}

function Mastercard() {
  return (
    <svg viewBox="0 0 36 22" className="h-5 w-auto" aria-hidden="true">
      <circle cx="14" cy="11" r="9" fill="#EB001B" />
      <circle cx="22" cy="11" r="9" fill="#F79E1B" />
      <path d="M18 4.2a9 9 0 0 1 0 13.6 9 9 0 0 1 0-13.6Z" fill="#FF5F00" />
    </svg>
  );
}

function ApplePay() {
  return (
    <svg viewBox="0 0 44 18" className="h-3.5 w-auto" aria-hidden="true" fill="#000">
      {/* Apple glyph */}
      <path d="M8.9 5.1c-.4.5-1.1.9-1.7.8-.1-.6.2-1.3.6-1.7.4-.5 1.1-.8 1.7-.9.1.7-.2 1.3-.6 1.8Zm.6 1c-.9-.1-1.7.5-2.2.5s-1.1-.5-1.9-.5c-1 0-1.9.6-2.4 1.5-1 1.8-.3 4.4.7 5.9.5.7 1.1 1.5 1.8 1.5.7 0 1-.5 1.9-.5s1.1.5 1.9.4c.8 0 1.3-.7 1.8-1.4.4-.5.5-1 .8-1.5-1.5-.6-1.7-2.7-.2-3.5-.5-.6-1.2-1-2-1Z" />
      {/* "Pay" wordmark */}
      <text x="17" y="14" fontFamily="Arial, Helvetica, sans-serif" fontSize="12" fontWeight="600" fill="#000">Pay</text>
    </svg>
  );
}

function ArCa() {
  return (
    <svg viewBox="0 0 40 16" className="h-3.5 w-auto" aria-hidden="true">
      <text x="20" y="13" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="13" fontWeight="800" letterSpacing="-0.3" fill="#009A44">ArCa</text>
    </svg>
  );
}

export function PaymentMethods({ className, note = true }: { className?: string; note?: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Chip label="Visa"><Visa /></Chip>
      <Chip label="Mastercard"><Mastercard /></Chip>
      <Chip label="ArCa"><ArCa /></Chip>
      <Chip label="Apple Pay"><ApplePay /></Chip>
      {note && <span className="text-xs text-basalt/45">Secured by PayLink</span>}
    </div>
  );
}
