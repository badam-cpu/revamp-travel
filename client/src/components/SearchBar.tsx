/** Revamp brandbook: use rounded white search surfaces, concise labels, and one unmistakable orange primary action. */
import { FormEvent, useRef, useState } from "react";
import { CalendarDays, MapPin, Search, X } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { cn } from "@/lib/utils";

const TYPES: { value: string; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "stay", label: "Places to stay" },
  { value: "eat", label: "Restaurants" },
  { value: "place", label: "Places to visit" },
  { value: "tour", label: "Tours" },
  { value: "experience", label: "Experiences" },
];

const LABEL = "block text-[11px] font-bold uppercase tracking-[0.16em] text-basalt/70";
// The cell (not the bare input) shows keyboard focus — an orange inset ring.
const CELL = "bg-chalk px-5 py-3 focus-within:shadow-[inset_0_0_0_2px_var(--color-apricot)]";

function shortDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
function nightsBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
/** "14 Oct" · "14 Oct → 17 Oct · 3 nights" · null (no dates yet) */
function datesSummary(range: boolean, checkin: string, checkout: string): string | null {
  if (!checkin) return null;
  if (!range) return shortDate(checkin);
  if (!checkout) return `${shortDate(checkin)} → add check-out`;
  const n = nightsBetween(checkin, checkout);
  return `${shortDate(checkin)} → ${shortDate(checkout)} · ${n} night${n === 1 ? "" : "s"}`;
}

/**
 * Date field: the on-brand calendar (same one listings use) instead of the
 * browser's dd.mm.yyyy box. Stays pick check-in → check-out; everything else a
 * single date. Past dates can't be picked. `inline` (mobile sheet) expands the
 * calendar in place instead of a popover.
 */
function DatesField({
  range,
  checkin,
  checkout,
  onChange,
  inline = false,
}: {
  range: boolean;
  checkin: string;
  checkout: string;
  onChange: (checkin: string, checkout: string) => void;
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const atOpen = useRef({ checkin, checkout });
  const summary = datesSummary(range, checkin, checkout);
  const label = range ? "Check-in → check-out" : "When";

  const calendar = (
    <AvailabilityCalendar
      key={range ? "range" : "single"}
      blockedRanges={[]}
      mode={range ? "range" : "single"}
      initialStart={checkin || null}
      initialEnd={checkout || null}
      className="border-0 p-0"
      showLegend={false}
      onChange={({ start, end }) => {
        const nextIn = start ?? "";
        const nextOut = range ? end ?? "" : "";
        if (nextIn === checkin && nextOut === checkout) return;
        onChange(nextIn, nextOut);
        // A complete, changed pick closes the picker.
        const changed = nextIn !== atOpen.current.checkin || nextOut !== atOpen.current.checkout;
        if (changed && nextIn && (!range || nextOut)) setOpen(false);
      }}
    />
  );

  const trigger = (
    <button
      type="button"
      onClick={inline ? () => { atOpen.current = { checkin, checkout }; setOpen((o) => !o); } : undefined}
      aria-expanded={open}
      className="flex w-full min-w-0 items-center gap-3 text-left focus-visible:outline-none"
    >
      <CalendarDays className="h-5 w-5 shrink-0 text-sevan" />
      <span className="min-w-0 flex-1">
        <span className={LABEL}>{label}</span>
        <span className={cn("block truncate py-1 text-[15px] font-semibold", !summary && "text-basalt/50")}>{summary ?? "Add dates"}</span>
      </span>
    </button>
  );

  const clear = summary && (
    <button
      type="button"
      onClick={() => onChange("", "")}
      aria-label="Clear dates"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-basalt/50 hover:bg-basalt/10 hover:text-basalt"
    >
      <X className="h-4 w-4" />
    </button>
  );

  if (inline) {
    return (
      <div className={CELL}>
        <div className="flex items-center gap-2">{trigger}{clear}</div>
        {open && <div className="mt-3 border-t border-basalt/10 pt-3">{calendar}</div>}
      </div>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) atOpen.current = { checkin, checkout };
        setOpen(o);
      }}
    >
      <div className={cn(CELL, "flex min-h-[78px] items-center gap-2")}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        {clear}
      </div>
      <PopoverContent align="end" sideOffset={10} className="w-[320px] rounded-none border-basalt/10 p-3 shadow-[0_22px_60px_rgba(35,35,33,0.18)]">
        {calendar}
      </PopoverContent>
    </Popover>
  );
}

export function SearchBar({
  compact = false,
  initialQuery = "",
  initialType = "all",
  mobileCollapse = false,
}: {
  compact?: boolean;
  initialQuery?: string;
  initialType?: string;
  /** Phones get one "Where to?" bar that opens the full search in a sheet. */
  mobileCollapse?: boolean;
}) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState(initialType || "all");
  // Check-in → check-out is stay-specific; every other search (Everything,
  // tours, experiences, restaurants) uses a single date.
  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const wantsRange = type === "stay";

  const changeType = (next: string) => {
    // Switching between a range (stays) and a single date keeps the first date.
    if ((next === "stay") !== wantsRange) setCheckout("");
    setType(next);
  };
  const setDates = (a: string, b: string) => {
    setCheckin(a);
    setCheckout(b);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSheetOpen(false);
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    // `date` = check-in (kept for any single-date consumer); checkin/checkout
    // carry the stay range.
    if (checkin) {
      params.set("date", checkin);
      params.set("checkin", checkin);
    }
    if (wantsRange && checkout) params.set("checkout", checkout);
    if (type === "tour") {
      navigate(`/explore/tour${params.toString() ? `?${params}` : ""}`);
      return;
    }
    if (type !== "all") params.set("type", type);
    navigate(`/explore${params.toString() ? `?${params}` : ""}`);
  };

  const typeLabel = TYPES.find((t) => t.value === type)?.label ?? "Everything";
  const whereField = (
    <label className={cn(CELL, "flex min-h-[78px] items-center gap-3")}>
      <MapPin className="h-5 w-5 shrink-0 text-tuff" />
      <span className="min-w-0 flex-1">
        <span className={LABEL}>Where</span>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Yerevan, Dilijan, wine…"
          className="h-auto border-0 bg-transparent px-0 py-1 text-[15px] font-semibold shadow-none placeholder:text-basalt/50 focus-visible:ring-0"
        />
      </span>
    </label>
  );
  const typeField = (
    <div className={cn(CELL, "flex min-h-[78px] items-center")}>
      <span className="min-w-0 flex-1">
        <span className={LABEL}>Explore</span>
        <Select value={type} onValueChange={changeType}>
          <SelectTrigger aria-label="What to explore" className="h-auto w-full border-0 bg-transparent px-0 py-1 text-[15px] font-semibold shadow-none focus:ring-0">
            <SelectValue placeholder="Everything" />
          </SelectTrigger>
          <SelectContent className="rounded-none bg-chalk">
            {TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </span>
    </div>
  );

  const summary = [query.trim() || "Anywhere", datesSummary(wantsRange, checkin, checkout) ?? "Any dates", typeLabel].join(" · ");

  return (
    <>
      {mobileCollapse && (
        <>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex w-full items-center gap-3 rounded-full bg-paper p-2 pr-5 text-left shadow-[0_18px_50px_rgba(35,35,33,0.18)] ring-1 ring-basalt/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot md:hidden"
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-apricot text-white"><Search className="h-5 w-5" /></span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-basalt">Where to?</span>
              <span className="block truncate text-xs text-basalt/60">{summary}</span>
            </span>
          </button>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent side="bottom" className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-[1.75rem] border-0 bg-paper p-0 md:hidden">
              <SheetHeader className="px-5 pb-2 pt-6 text-left">
                <SheetTitle className="font-display text-2xl tracking-[-0.03em]">Where to?</SheetTitle>
                <SheetDescription className="text-sm text-basalt/60">Search stays, tables, tours and places across Armenia.</SheetDescription>
              </SheetHeader>
              <form onSubmit={submit} className="grid px-5 pb-6 pt-3">
                <div className="search-desk grid gap-px border border-basalt/10 bg-basalt/10">
                  {whereField}
                  {typeField}
                  <DatesField inline range={wantsRange} checkin={checkin} checkout={checkout} onChange={setDates} />
                </div>
                <Button type="submit" className="mt-4 h-14 w-full rounded-none bg-apricot text-base text-white hover:bg-apricot/90">
                  <Search className="mr-2 h-4 w-4" /> Search
                </Button>
              </form>
            </SheetContent>
          </Sheet>
        </>
      )}

      <form
        onSubmit={submit}
        className={cn(
          "search-desk grid bg-chalk text-basalt shadow-[0_22px_60px_rgba(35,35,33,0.14)]",
          compact ? "gap-px border border-basalt/10 md:grid-cols-[1.6fr_1fr_auto]" : "gap-px border border-basalt/10 lg:grid-cols-[1.35fr_0.8fr_1.15fr_auto]",
          mobileCollapse && "hidden md:grid",
        )}
      >
        {whereField}
        {typeField}
        {!compact && <DatesField range={wantsRange} checkin={checkin} checkout={checkout} onChange={setDates} />}
        <div className="flex bg-chalk p-2">
          <Button type="submit" className="min-h-[62px] w-full rounded-none bg-apricot px-7 text-white hover:bg-apricot/90 focus-visible:ring-2 focus-visible:ring-basalt focus-visible:ring-offset-2 focus-visible:ring-offset-chalk">
            <Search className="mr-2 h-4 w-4" /> Search
          </Button>
        </div>
      </form>
    </>
  );
}
