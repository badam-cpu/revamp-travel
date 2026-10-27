/**
 * Admin → Text fixes. Published listings whose card text (title, category
 * label, short description) breaks the length rules in shared/listings.ts.
 * Aha suggests a version that fits with the same facts; the admin reviews
 * before → after, can edit any suggestion, and approves per listing or all at
 * once. NOTHING is saved until approved, and the server re-checks every value
 * (server/textFixes.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CharCount } from "@/components/CharCount";
import {
  adminTextFixApply,
  adminTextFixScan,
  adminTextFixSuggest,
  type TextFixField,
  type TextFixListing,
} from "@/lib/api";
import { listingTextProblem, typeLabels, type ListingType } from "@shared/listings";
import { cn } from "@/lib/utils";

const FIELD_LABEL: Record<TextFixField, string> = {
  title: "Title",
  eyebrow: "Category label",
  shortDescription: "Short description",
};
const TYPE_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "stay", label: "Stays" },
  { key: "tour", label: "Tours" },
  { key: "experience", label: "Experiences" },
  { key: "eat", label: "Restaurants" },
  { key: "place", label: "Places" },
];

type Draft = { value: string; state: "empty" | "loading" | "ready" | "failed" };
type RowState = "open" | "saving" | "saved" | "skipped";
const key = (id: string, field: TextFixField) => `${id}:${field}`;

export function AdminTextFixes() {
  const [listings, setListings] = useState<TextFixListing[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [filter, setFilter] = useState("all");
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const stopRef = useRef(false);

  const scan = useCallback(async () => {
    setListings(null);
    try {
      const { listings } = await adminTextFixScan();
      setListings(listings);
      setRows({});
      setDrafts({});
    } catch (e) {
      console.error("[text-fixes] scan", e);
      setListings([]);
      toast(e instanceof Error ? e.message : "Couldn't check listings right now.");
    }
  }, []);
  useEffect(() => { void scan(); }, [scan]);

  const visible = useMemo(
    () => (listings ?? []).filter((l) => (filter === "all" || l.type === filter) && rows[l.id] !== "saved" && rows[l.id] !== "skipped"),
    [listings, filter, rows],
  );
  const openCount = (listings ?? []).filter((l) => rows[l.id] !== "saved" && rows[l.id] !== "skipped").length;
  const savedCount = Object.values(rows).filter((r) => r === "saved").length;

  const setDraft = (id: string, field: TextFixField, d: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [key(id, field)]: { ...(prev[key(id, field)] ?? { value: "", state: "empty" }), ...d } }));

  const fits = (l: TextFixListing, field: TextFixField) => {
    const v = drafts[key(l.id, field)]?.value?.trim() ?? "";
    return !!v && listingTextProblem(field, v, { listingType: l.type as ListingType }) === null;
  };
  const ready = (l: TextFixListing) => l.problems.every((p) => fits(l, p.field));

  const suggestOne = async (l: TextFixListing, field: TextFixField) => {
    setDraft(l.id, field, { state: "loading" });
    try {
      const { suggestion } = await adminTextFixSuggest(l.id, field);
      if (!suggestion) {
        setDraft(l.id, field, { state: "failed" });
        return;
      }
      setDraft(l.id, field, { value: suggestion.suggested, state: suggestion.suggested ? "ready" : "failed" });
    } catch (e) {
      console.error("[text-fixes] suggest", e);
      setDraft(l.id, field, { state: "failed" });
    }
  };
  const suggestListing = (l: TextFixListing) => Promise.all(l.problems.map((p) => suggestOne(l, p.field)));

  /** Aha for every visible field that has no draft yet — 3 at a time, stoppable. */
  const suggestAll = async () => {
    const jobs = visible.flatMap((l) => l.problems.filter((p) => !drafts[key(l.id, p.field)]?.value).map((p) => ({ l, field: p.field })));
    if (!jobs.length) return;
    stopRef.current = false;
    setBulk({ done: 0, total: jobs.length });
    let next = 0;
    const worker = async () => {
      while (!stopRef.current && next < jobs.length) {
        const job = jobs[next++];
        await suggestOne(job.l, job.field);
        setBulk((b) => (b ? { ...b, done: b.done + 1 } : b));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setBulk(null);
  };

  const approve = async (l: TextFixListing, quiet = false) => {
    const changes = Object.fromEntries(l.problems.map((p) => [p.field, drafts[key(l.id, p.field)]?.value?.trim() ?? ""]));
    setRows((r) => ({ ...r, [l.id]: "saving" }));
    try {
      await adminTextFixApply(l.id, changes);
      setRows((r) => ({ ...r, [l.id]: "saved" }));
      if (!quiet) toast(`Saved “${changes.title || l.title}”.`);
      return true;
    } catch (e) {
      console.error("[text-fixes] apply", e);
      setRows((r) => ({ ...r, [l.id]: "open" }));
      toast(e instanceof Error ? e.message : "Couldn't save that change.");
      return false;
    }
  };

  const readyRows = visible.filter((l) => rows[l.id] !== "saving" && ready(l));
  const approveAll = async () => {
    setConfirmAll(false);
    let ok = 0;
    for (const l of readyRows) if (await approve(l, true)) ok++;
    toast(`Saved ${ok} listing${ok === 1 ? "" : "s"}.`);
  };

  return (
    <div>
      <PageHeader title="Text fixes" sub="Published listings whose text breaks the card rules. Aha AI suggests a fit with the same facts; nothing changes until you approve." />

      {listings === null ? (
        <p className="inline-flex items-center gap-2 text-sm text-basalt/55"><Loader2 className="h-4 w-4 animate-spin" /> Checking listings…</p>
      ) : (
        <>
          <div className="mb-6 grid gap-3 border-b border-basalt/10 pb-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="font-semibold">{openCount} listing{openCount === 1 ? "" : "s"} to fix</span>
              {savedCount > 0 && <span className="text-basalt/55">· {savedCount} saved</span>}
              <div className="ml-auto flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="rounded-none" onClick={() => void scan()} disabled={!!bulk}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Re-check
                </Button>
                {bulk ? (
                  <Button variant="outline" size="sm" className="rounded-none" onClick={() => (stopRef.current = true)}>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Suggesting {bulk.done} / {bulk.total} · Stop
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="rounded-none" onClick={() => void suggestAll()} disabled={!visible.length}>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5 text-apricot" /> Suggest all with Aha AI
                  </Button>
                )}
                {confirmAll ? (
                  <span className="inline-flex items-center gap-2">
                    <Button size="sm" className="rounded-none bg-apricot text-paper hover:bg-apricot/90" onClick={() => void approveAll()}>
                      Save {readyRows.length} listing{readyRows.length === 1 ? "" : "s"}
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-none" onClick={() => setConfirmAll(false)}>Cancel</Button>
                  </span>
                ) : (
                  <Button size="sm" className="rounded-none bg-basalt text-paper hover:bg-basalt/90" onClick={() => setConfirmAll(true)} disabled={!readyRows.length || !!bulk}>
                    <Check className="mr-1.5 h-3.5 w-3.5" /> Approve all ready ({readyRows.length})
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TYPE_FILTERS.map((t) => {
                const n = (listings ?? []).filter((l) => (t.key === "all" || l.type === t.key) && rows[l.id] !== "saved" && rows[l.id] !== "skipped").length;
                if (t.key !== "all" && n === 0) return null;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setFilter(t.key)}
                    aria-pressed={filter === t.key}
                    className={cn("rounded-none border px-3 py-1 text-xs font-semibold", filter === t.key ? "border-basalt bg-basalt text-paper" : "border-basalt/15 text-basalt/65 hover:border-basalt/40")}
                  >
                    {t.label} <span className="tabular-nums opacity-60">{n}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="border border-basalt/10 bg-chalk/50 p-8 text-center">
              <p className="font-semibold">{openCount === 0 ? "Every published listing fits the card rules." : "Nothing left in this filter."}</p>
              {savedCount > 0 && <p className="mt-1 text-sm text-basalt/55">{savedCount} listing{savedCount === 1 ? "" : "s"} updated this session.</p>}
            </div>
          ) : (
            <ul className="grid gap-4">
              {visible.map((l) => {
                const saving = rows[l.id] === "saving";
                const anyLoading = l.problems.some((p) => drafts[key(l.id, p.field)]?.state === "loading");
                return (
                  <li key={l.id} className="border border-basalt/12 bg-paper p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/45">{typeLabels[l.type as ListingType] ?? l.type} · {l.city}</p>
                        <a href={`/listing/${l.slug}`} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1.5 font-semibold hover:text-apricot">
                          {l.title} <ExternalLink className="h-3.5 w-3.5 opacity-50" />
                        </a>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="rounded-none" onClick={() => void suggestListing(l)} disabled={anyLoading || saving || !!bulk}>
                          {anyLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5 text-apricot" />} Suggest
                        </Button>
                        <Button variant="ghost" size="sm" className="rounded-none" onClick={() => setRows((r) => ({ ...r, [l.id]: "skipped" }))} disabled={saving}>
                          <X className="mr-1 h-3.5 w-3.5" /> Skip
                        </Button>
                        <Button size="sm" className="rounded-none bg-apricot text-paper hover:bg-apricot/90" onClick={() => void approve(l)} disabled={!ready(l) || saving}>
                          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Approve
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4">
                      {l.problems.map((p) => {
                        const d = drafts[key(l.id, p.field)];
                        const id = `fix-${l.id}-${p.field}`;
                        return (
                          <div key={p.field} className="grid gap-3 border-t border-basalt/8 pt-4 md:grid-cols-2">
                            <div>
                              <p className="text-xs font-semibold text-basalt/60">{FIELD_LABEL[p.field]} · now</p>
                              <p className="mt-1.5 text-sm leading-6 text-basalt/70">{p.current || <span className="italic text-basalt/40">empty</span>}</p>
                              <p className="mt-1 text-xs text-apricot">{p.current.trim().length} characters — needs {p.min}–{p.max}</p>
                            </div>
                            <div>
                              <label htmlFor={id} className="text-xs font-semibold text-basalt/60">{FIELD_LABEL[p.field]} · suggested</label>
                              <Textarea
                                id={id}
                                rows={p.field === "shortDescription" ? 2 : 1}
                                value={d?.value ?? ""}
                                onChange={(e) => setDraft(l.id, p.field, { value: e.target.value, state: "ready" })}
                                placeholder={d?.state === "loading" ? "Aha AI is writing…" : "Click Suggest, or type your own"}
                                disabled={d?.state === "loading" || saving}
                                className="mt-1.5 min-h-0 resize-none rounded-none text-sm"
                              />
                              <div className="mt-1 flex items-center justify-between gap-3">
                                <span className="text-xs text-basalt/45">
                                  {d?.state === "failed" ? "Aha AI couldn't fit this one — type a version yourself." : fits(l, p.field) ? "Fits the card." : ""}
                                </span>
                                <CharCount field={p.field} value={d?.value ?? ""} listingType={l.type as ListingType} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
