/**
 * Dashboard → Customer journey (migration 0098). Operators shape what guests
 * receive around each booking:
 *   • Messages — one card per step (stays: check-in, mid-stay, checkout, thank
 *     you; tours/experiences: meeting point, thank you). Each has an Automatic
 *     switch (off until the operator turns it on), timing, channels, subject +
 *     email body (`**bold**`, placeholders) + a short text with the trip link,
 *     an optional survey, a live preview and "Send test to me". Operator-wide per
 *     listing type, with an optional per-listing version.
 *   • Listing details — private per-listing values for placeholders (Wi-Fi,
 *     door code, parking, host phone) so one template fits every listing.
 *   • Review links — Google (from the Place ID) / Tripadvisor, shown to EVERY
 *     survey respondent (no review gating), and a reply-to address.
 *   • Feedback — survey answers (private), low scores highlighted.
 * Templates/details/settings are written under RLS (client/src/lib/journey.ts);
 * previews render with the same shared code the server sends with.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Loader2, Mail, MessageSquare, Smartphone, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BoldButton } from "@/components/BoldButton";
import { RichText } from "@/components/RichText";
import { useAuth } from "@/contexts/AuthContext";
import { useListings, type LiveListing } from "@/contexts/ListingsContext";
import { ahaJourneyTemplate, sendJourneyTest } from "@/lib/api";
import {
  EMPTY_DETAILS,
  deleteJourneyTemplate,
  fetchJourneySettings,
  fetchJourneyTemplates,
  fetchListingDetails,
  fetchSurveyAnswers,
  saveJourneySettings,
  saveJourneyTemplate,
  saveListingDetails,
  type JourneySettings,
  type ListingDetails,
  type SurveyAnswer,
} from "@/lib/journey";
import {
  JOURNEY_STEPS,
  PLACEHOLDERS,
  googleReviewUrl,
  listingPreviewVars,
  MAX_REVIEW_LINKS,
  REVIEW_PLATFORMS,
  resolveReviewButtons,
  reviewLinkProblem,
  type ReviewLink,
  type ReviewPlatform,
  renderTemplate,
  resolveTemplate,
  sampleVars,
  stepsFor,
  type JourneyListingType,
  type JourneyStep,
  type JourneyTemplate,
} from "@shared/journey";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<JourneyListingType, string> = { stay: "Stays", tour: "Tours", experience: "Experiences" };
const TIMES = Array.from({ length: 34 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`); // 06:00–22:30
const FIELD = "h-12 rounded-none text-base md:text-base";
type Tab = "messages" | "details" | "links" | "feedback";

/** Insert `{key}` at the caret of a (controlled) input/textarea. */
function insertAtCaret(id: string, text: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement | HTMLInputElement | null;
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  el.setSelectionRange(start + text.length, start + text.length);
}

function describeTiming(t: JourneyTemplate): string {
  const anchor = t.listingType === "stay" ? (JOURNEY_STEPS[t.step].anchor === "end" ? "checkout" : "check-in") : "the experience";
  const d = t.timing.offsetDays;
  const when = d === 0 ? `on the day of ${anchor}` : `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} ${d < 0 ? "before" : "after"} ${anchor}`;
  return `${when}, ${t.timing.at}`;
}

export function CustomerJourney() {
  const { user } = useAuth();
  const { listings } = useListings();
  const mine = useMemo(() => listings.filter((l) => l.operatorId === user?.id && (l.type === "stay" || l.type === "tour" || l.type === "experience")), [listings, user?.id]);
  const types = useMemo(() => (["stay", "tour", "experience"] as const).filter((t) => mine.some((l) => l.type === t)), [mine]);
  const [tab, setTab] = useState<Tab>("messages");
  const [type, setType] = useState<JourneyListingType>("stay");
  const [scope, setScope] = useState<string>(""); // "" = all listings of the type
  const [templates, setTemplates] = useState<JourneyTemplate[] | null | undefined>(undefined);

  useEffect(() => {
    if (types.length && !types.includes(type as never)) setType(types[0]);
  }, [types, type]);
  useEffect(() => setScope(""), [type]);

  const reload = useCallback(() => {
    if (!user) return;
    fetchJourneyTemplates(user.id).then(setTemplates);
  }, [user]);
  useEffect(reload, [reload]);

  if (!user) return null;
  if (templates === undefined) return <p className="inline-flex items-center gap-2 text-sm text-basalt/55"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (templates === null) return <p className="border border-dashed border-basalt/20 bg-chalk px-5 py-8 text-sm text-basalt/60">Customer journey isn't available yet — check back soon.</p>;
  if (!types.length) return <p className="border border-dashed border-basalt/20 bg-chalk px-5 py-8 text-sm text-basalt/60">Add a stay, tour or experience first — then set up the messages your guests receive.</p>;

  const ofType = mine.filter((l) => l.type === type);
  const scopeListing = ofType.find((l) => l.id === scope) ?? null;

  return (
    <div className="grid gap-6">
      <div role="tablist" aria-label="Customer journey" className="flex flex-wrap gap-2">
        {(
          [
            ["messages", "Messages"],
            ["details", "Listing details"],
            ["links", "Review links"],
            ["feedback", "Guest feedback"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn("inline-flex h-10 items-center rounded-full border px-4 text-sm font-semibold transition-colors", tab === k ? "border-basalt bg-basalt text-paper" : "border-basalt/15 bg-paper text-basalt/70 hover:border-basalt/40")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "messages" && (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-end gap-3">
            {types.length > 1 && (
              <div className="grid gap-1.5">
                <span className="text-xs font-semibold text-basalt/60">Listing type</span>
                <div className="flex gap-1.5">
                  {types.map((t) => (
                    <button key={t} type="button" onClick={() => setType(t)} aria-pressed={type === t} className={cn("h-10 rounded-none border px-3 text-sm font-semibold", type === t ? "border-apricot bg-apricot/10" : "border-basalt/15 text-basalt/65 hover:border-basalt/40")}>
                      {TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid min-w-[16rem] flex-1 gap-1.5 sm:max-w-sm">
              <Label htmlFor="cj-scope" className="text-xs font-semibold text-basalt/60">Applies to</Label>
              <select id="cj-scope" value={scope} onChange={(e) => setScope(e.target.value)} className="h-12 w-full rounded-[0.875rem] border border-basalt/15 bg-paper px-3 text-base">
                <option value="">All my {TYPE_LABEL[type].toLowerCase()} (default)</option>
                {ofType.map((l) => (
                  <option key={l.id} value={l.id}>Only: {l.title}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="max-w-3xl text-sm leading-6 text-basalt/60">
            Each message goes by email (full text), a short text with a link to the guest's private trip page (SMS / WhatsApp / Viber for guests who opted in, Telegram if linked) and the booking's inbox. Automatic sending is off until you switch it on. You can always send any message by hand from a booking.
          </p>
          {stepsFor(type).map((step) => (
            <StepCard
              key={`${type}-${scope}-${step}`}
              operatorId={user.id}
              type={type}
              step={step}
              listing={scopeListing}
              templates={templates}
              onSaved={reload}
            />
          ))}
        </div>
      )}
      {tab === "details" && <DetailsTab listings={mine} />}
      {tab === "links" && <LinksTab operatorId={user.id} />}
      {tab === "feedback" && <FeedbackTab />}
    </div>
  );
}

// ── One step ────────────────────────────────────────────────────────────────

function StepCard({
  operatorId,
  type,
  step,
  listing,
  templates,
  onSaved,
}: {
  operatorId: string;
  type: JourneyListingType;
  step: JourneyStep;
  listing: LiveListing | null;
  templates: JourneyTemplate[];
  onSaved: () => void;
}) {
  const meta = JOURNEY_STEPS[step];
  // What applies here: this listing's own version, else the default for the type.
  const resolved = resolveTemplate(templates, { id: listing?.id ?? "__none__", type }, step);
  const isOverride = !!listing && resolved.listingId === listing.id;
  const inherited = !!listing && !isOverride;
  const [draft, setDraft] = useState<JourneyTemplate>(resolved);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "test" | "aha" | "revert" | "toggle">("");
  const [details, setDetails] = useState<ListingDetails | null>(null);
  useEffect(() => {
    if (listing) fetchListingDetails([listing.id]).then((m) => setDetails(m.get(listing.id) ?? null));
  }, [listing]);

  const dirty = JSON.stringify({ ...draft, id: undefined, isDefault: undefined }) !== JSON.stringify({ ...resolved, id: undefined, isDefault: undefined });
  const set = <K extends keyof JourneyTemplate>(k: K, v: JourneyTemplate[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const vars = listing
    ? listingPreviewVars(type, { title: listing.title, type, facts: listing.facts, address: listing.address, multiRoom: listing.multiRoom }, details)
    : sampleVars(type);
  const preview = {
    subject: renderTemplate(draft.subject, vars),
    body: renderTemplate(draft.body, vars, { dropEmptyLines: true }),
    text: renderTemplate(draft.textBody, vars),
  };
  const ids = { subject: `cj-${step}-subject`, body: `cj-${step}-body`, text: `cj-${step}-text` };

  const persist = async (next: JourneyTemplate, what: typeof busy, okMsg: string) => {
    setBusy(what);
    try {
      // Editing under "Only: <listing>" creates that listing's own version.
      const target = listing && !isOverride ? { ...next, id: undefined, listingId: listing.id } : next;
      const saved = await saveJourneyTemplate(operatorId, { ...target, listingType: type });
      // The switch saves only on/off — keep any unsaved edits in the form.
      setDraft((d) => (what === "toggle" ? { ...d, enabled: saved.enabled, id: saved.id, listingId: saved.listingId } : saved));
      toast.success(okMsg);
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save this message.");
    } finally {
      setBusy("");
    }
  };

  const revert = async () => {
    if (!resolved.id || !isOverride) return;
    if (!window.confirm(`Remove the version for ${listing?.title}? It will use your default for all ${TYPE_LABEL[type].toLowerCase()} again.`)) return;
    setBusy("revert");
    try {
      await deleteJourneyTemplate(resolved.id);
      toast.success("Back to your default.");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't remove it.");
    } finally {
      setBusy("");
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      const r = await sendJourneyTest({ step, listingType: type, listingId: listing?.id ?? null, subject: draft.subject, body: draft.body, textBody: draft.textBody });
      toast.success(`Test sent to ${r.to}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't send the test.");
    } finally {
      setBusy("");
    }
  };

  const aha = async () => {
    setBusy("aha");
    try {
      const r = await ahaJourneyTemplate({
        step,
        listingType: type,
        current: { subject: draft.subject, body: draft.body, textBody: draft.textBody },
        context: listing ? { title: listing.title, city: listing.city, facts: (listing.facts ?? []).filter((f) => f.label && f.value).slice(0, 20) } : {},
      });
      setDraft((d) => ({ ...d, subject: r.subject || d.subject, body: r.body || d.body, textBody: r.textBody || d.textBody }));
      toast.success("Aha drafted it — review, then save.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Aha couldn't draft that right now.");
    } finally {
      setBusy("");
    }
  };

  const days = Math.abs(draft.timing.offsetDays);
  const dir = draft.timing.offsetDays < 0 ? "before" : draft.timing.offsetDays > 0 ? "after" : "on";
  const anchorWord = type === "stay" ? (meta.anchor === "end" ? "checkout" : "check-in") : "the experience day";
  const placeholders = PLACEHOLDERS.filter((p) => p.types.includes(type));

  return (
    <section className="border border-basalt/12 bg-paper">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-basalt/45 transition-transform", open && "rotate-180")} />
          <span className="min-w-0">
            <span className="block font-semibold">{meta.label}</span>
            <span className="block text-xs text-basalt/55">
              {resolved.enabled ? `Automatic · ${describeTiming(resolved)}` : "Automatic sending off"}
              {inherited ? " · using your default" : isOverride ? " · this listing's own version" : ""}
            </span>
          </span>
        </button>
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-basalt/65">
          Automatic
          <Switch
            checked={resolved.enabled}
            disabled={busy !== ""}
            onCheckedChange={(on) => void persist({ ...resolved, enabled: on }, "toggle", on ? `${meta.label}: automatic sending on.` : `${meta.label}: automatic sending off.`)}
            aria-label={`Send ${meta.label} automatically`}
          />
        </label>
      </div>

      {open && (
        <div className="grid gap-5 border-t border-basalt/10 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="listing-form grid gap-4">
            <p className="text-sm text-basalt/60">{meta.hint}</p>
            {inherited && <p className="border border-apricot/30 bg-apricot/5 px-3 py-2 text-xs text-basalt/70">You're seeing your default for all {TYPE_LABEL[type].toLowerCase()}. Saving here creates a version just for {listing!.title}.</p>}

            <div className="grid gap-1.5">
              <span className="text-sm font-semibold">When</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_7rem]">
                <Input type="number" min={0} max={30} value={days} disabled={dir === "on"} onChange={(e) => set("timing", { ...draft.timing, offsetDays: (dir === "before" ? -1 : 1) * Math.min(30, Math.max(0, Number(e.target.value) || 0)) })} className={FIELD} aria-label="Days" />
                <select
                  value={dir}
                  onChange={(e) => {
                    const v = e.target.value;
                    set("timing", { ...draft.timing, offsetDays: v === "on" ? 0 : (v === "before" ? -1 : 1) * Math.max(1, days) });
                  }}
                  className="h-12 w-full rounded-[0.875rem] border border-basalt/15 bg-paper px-3 text-base"
                  aria-label="Before or after"
                >
                  <option value="before">day(s) before {anchorWord}</option>
                  <option value="on">on the day of {anchorWord}</option>
                  <option value="after">day(s) after {anchorWord}</option>
                </select>
                <select value={draft.timing.at} onChange={(e) => set("timing", { ...draft.timing, at: e.target.value })} className="h-12 w-full rounded-[0.875rem] border border-basalt/15 bg-paper px-3 text-base" aria-label="Time (Armenia)">
                  {TIMES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-basalt/45">Armenia time. Bookings made later than this still get it right away, while it's useful.</p>
            </div>

            {step === "midstay" && (
              <div className="grid max-w-xs gap-1.5">
                <Label htmlFor={`cj-${step}-min`} className="text-sm font-semibold">Only for stays of at least</Label>
                <Input id={`cj-${step}-min`} type="number" min={2} max={30} value={Math.max(2, draft.minNights)} onChange={(e) => set("minNights", Math.max(2, Number(e.target.value) || 2))} className={FIELD} />
                <p className="text-xs text-basalt/45">nights</p>
              </div>
            )}

            <div className="grid gap-1.5">
              <span className="text-sm font-semibold">Send by</span>
              <div className="flex flex-wrap gap-4 text-sm">
                {(
                  [
                    ["email", "Email", Mail],
                    ["text", "Text with link", Smartphone],
                    ["inbox", "Inbox", MessageSquare],
                  ] as const
                ).map(([k, label, Icon]) => (
                  <label key={k} className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={draft.channels[k]} onChange={(e) => set("channels", { ...draft.channels, [k]: e.target.checked })} className="h-4 w-4 accent-[#F15822]" />
                    <Icon className="h-4 w-4 text-basalt/50" /> {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor={ids.subject} className="text-sm font-semibold">Subject</Label>
              <Input id={ids.subject} value={draft.subject} maxLength={200} onChange={(e) => set("subject", e.target.value)} className={FIELD} />
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={ids.body} className="text-sm font-semibold">Email message</Label>
                <div className="flex items-center gap-2">
                  <BoldButton forId={ids.body} />
                  <Button type="button" variant="outline" size="sm" disabled={busy !== ""} onClick={() => void aha()} className="h-8 rounded-none border-basalt/15 text-xs">
                    <Sparkles className="mr-1 h-3.5 w-3.5 text-apricot" /> {busy === "aha" ? "Drafting…" : "Aha AI"}
                  </Button>
                </div>
              </div>
              <textarea id={ids.body} value={draft.body} maxLength={6000} rows={12} onChange={(e) => set("body", e.target.value)} className="w-full rounded-[0.875rem] border border-basalt/15 bg-paper px-3 py-2.5 text-base leading-7 outline-none focus:border-apricot" />
              <div className="flex flex-wrap gap-1.5">
                {placeholders.filter((p) => p.key !== "trip_link").map((p) => (
                  <button key={p.key} type="button" onClick={() => insertAtCaret(ids.body, `{${p.key}}`)} className="rounded-full border border-basalt/15 px-2.5 py-1 text-[11px] font-semibold text-basalt/65 hover:border-apricot hover:text-apricot">
                    + {p.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-basalt/45">A line whose detail is empty for a booking (e.g. no door code) is left out automatically. The email adds a button to the guest's trip page.</p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor={ids.text} className="text-sm font-semibold">Text message</Label>
              <Input id={ids.text} value={draft.textBody} maxLength={480} onChange={(e) => set("textBody", e.target.value)} className={FIELD} />
              <p className={cn("text-xs", preview.text.length > 160 ? "text-tuff" : "text-basalt/45")}>
                {preview.text.length}/160 characters with a sample link{preview.text.length > 160 ? " — over one SMS; shorten it" : ""}. Keep <code>{"{trip_link}"}</code> in it.
              </p>
            </div>

            {meta.surveyAllowed && (
              <label className="inline-flex items-start gap-2 text-sm">
                <input type="checkbox" checked={draft.survey} onChange={(e) => set("survey", e.target.checked)} className="mt-1 h-4 w-4 accent-[#F15822]" />
                <span>
                  <span className="font-semibold">Ask for a 1–5 rating</span>
                  <span className="block text-xs text-basalt/50">On the trip page. Answers are private to you. Everyone who answers sees your Google / Tripadvisor links; 1–3 alerts you at once.</span>
                </span>
              </label>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-basalt/10 pt-4">
              <Button type="button" disabled={busy !== "" || (!dirty && !inherited)} onClick={() => void persist(draft, "save", "Saved.")} className="h-11 rounded-none bg-apricot px-6 text-white hover:bg-apricot/90">
                {busy === "save" ? "Saving…" : inherited ? `Save for ${listing!.title.slice(0, 24)}${listing!.title.length > 24 ? "…" : ""}` : "Save"}
              </Button>
              <Button type="button" variant="outline" disabled={busy !== ""} onClick={() => void test()} className="h-11 rounded-none border-basalt/20">
                {busy === "test" ? "Sending…" : "Send test to me"}
              </Button>
              {isOverride && (
                <button type="button" onClick={() => void revert()} disabled={busy !== ""} className="text-sm font-semibold text-basalt/50 hover:text-destructive">
                  Use my default instead
                </button>
              )}
              {dirty && <span className="text-xs text-tuff">Unsaved changes</span>}
            </div>
          </div>

          <aside className="grid content-start gap-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">Preview{listing ? ` · ${listing.title}` : " · sample booking"}</p>
            <div className="border border-basalt/10 bg-chalk/60 p-4">
              <p className="font-display text-lg leading-snug tracking-[-0.01em]">{preview.subject || "—"}</p>
              <RichText text={preview.body} className="mt-2 whitespace-pre-line text-sm leading-6 text-basalt/80" />
              <span className="mt-3 inline-flex rounded-[0.5rem] bg-apricot px-3 py-1.5 text-xs font-semibold text-white">{meta.cta}</span>
            </div>
            <div className="border border-basalt/10 bg-chalk/60 p-3">
              <p className="text-[11px] font-semibold text-basalt/50">Text</p>
              <p className="mt-1 text-sm">{preview.text || "—"}</p>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

// ── Listing details ─────────────────────────────────────────────────────────

const DETAIL_FIELDS: { key: keyof ListingDetails; label: string; placeholder: string; stayOnly?: boolean; long?: boolean }[] = [
  { key: "host_phone", label: "Your phone for guests", placeholder: "+374 99 000000" },
  { key: "wifi_name", label: "Wi-Fi network", placeholder: "Revamp-Guest", stayOnly: true },
  { key: "wifi_password", label: "Wi-Fi password", placeholder: "••••••••", stayOnly: true },
  { key: "door_code", label: "Door / lockbox code", placeholder: "4821#", stayOnly: true },
  { key: "parking", label: "Parking", placeholder: "Free street parking out front", long: true },
  { key: "notes", label: "Private notes (not sent)", placeholder: "Anything for you or your team", long: true },
];

function DetailsTab({ listings }: { listings: LiveListing[] }) {
  const [id, setId] = useState(listings[0]?.id ?? "");
  const [values, setValues] = useState<ListingDetails>(EMPTY_DETAILS);
  const [saved, setSaved] = useState<ListingDetails>(EMPTY_DETAILS);
  const [busy, setBusy] = useState(false);
  const listing = listings.find((l) => l.id === id) ?? null;
  useEffect(() => {
    if (!id) return;
    fetchListingDetails([id]).then((m) => {
      const v = m.get(id) ?? EMPTY_DETAILS;
      setValues(v);
      setSaved(v);
    });
  }, [id]);
  if (!listing) return null;
  const save = async () => {
    setBusy(true);
    try {
      await saveListingDetails(id, values);
      setSaved(values);
      toast.success("Details saved.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="listing-form grid max-w-3xl gap-4">
      <p className="text-sm leading-6 text-basalt/60">Private to you — never shown on your listing. They fill the placeholders in your messages (e.g. <code>{"{door_code}"}</code>), so one message works for every listing. Guests see them only in the messages you send.</p>
      <div className="grid gap-1.5 sm:max-w-sm">
        <Label htmlFor="cj-details-listing" className="text-sm font-semibold">Listing</Label>
        <select id="cj-details-listing" value={id} onChange={(e) => setId(e.target.value)} className="h-12 w-full rounded-[0.875rem] border border-basalt/15 bg-paper px-3 text-base">
          {listings.map((l) => (
            <option key={l.id} value={l.id}>{l.title}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DETAIL_FIELDS.filter((f) => !f.stayOnly || listing.type === "stay").map((f) => (
          <div key={f.key} className={cn("grid gap-1.5", f.long && "sm:col-span-2")}>
            <Label htmlFor={`cj-d-${f.key}`} className="text-sm font-semibold">{f.label}</Label>
            <Input id={`cj-d-${f.key}`} value={values[f.key]} placeholder={f.placeholder} maxLength={f.key === "notes" ? 2000 : f.long ? 500 : 120} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={FIELD} autoComplete="off" />
          </div>
        ))}
      </div>
      <p className="text-xs text-basalt/45">The address comes from your listing's address field; check-in / checkout times and the meeting point from its details.</p>
      <div>
        <Button type="button" onClick={() => void save()} disabled={busy || JSON.stringify(values) === JSON.stringify(saved)} className="h-11 rounded-none bg-apricot px-6 text-white hover:bg-apricot/90">
          {busy ? "Saving…" : "Save details"}
        </Button>
      </div>
    </div>
  );
}

// ── Review links + reply-to ─────────────────────────────────────────────────

function LinksTab({ operatorId }: { operatorId: string }) {
  const [s, setS] = useState<JourneySettings | null>(null);
  const [placeId, setPlaceId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchJourneySettings(operatorId).then((r) => {
      setS(r.settings);
      setPlaceId(r.googlePlaceId);
    });
  }, [operatorId]);
  if (!s) return <p className="text-sm text-basalt/55">Loading…</p>;
  const auto = googleReviewUrl(placeId);
  const links = s.review_links;
  const setLinks = (next: ReviewLink[]) => setS({ ...s, review_links: next });
  const update = (i: number, patch: Partial<ReviewLink>) => setLinks(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= links.length) return;
    const next = [...links];
    [next[i], next[j]] = [next[j], next[i]];
    setLinks(next);
  };
  const used = new Set(links.map((l) => l.platform));
  const nextPlatform = (["google", "tripadvisor", "trustpilot", "facebook", "other"] as ReviewPlatform[]).find((p) => p === "other" || !used.has(p)) ?? "other";
  const buttons = resolveReviewButtons({ review_links: links.filter((l) => !reviewLinkProblem(l)) }, placeId);

  const save = async () => {
    const cleaned = links.filter((l) => l.url.trim()).map((l) => ({ ...l, url: l.url.trim(), label: l.label?.trim() || undefined }));
    for (const l of cleaned) {
      const p = reviewLinkProblem(l);
      if (p) return toast(p);
    }
    if (s.reply_to_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.reply_to_email)) return toast("Enter a valid reply-to email.");
    setBusy(true);
    try {
      await saveJourneySettings(operatorId, { ...s, review_links: cleaned });
      setS({ ...s, review_links: cleaned });
      toast.success("Saved.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="listing-form grid max-w-3xl gap-5">
      <p className="text-sm leading-6 text-basalt/60">
        After a guest answers your survey, they see a button for each site below — every guest, whatever their score. Google, Tripadvisor, Trustpilot and Facebook don't allow asking only happy guests, so the buttons are never hidden for low scores.
      </p>

      <div className="grid gap-3">
        <span className="text-sm font-semibold">Review sites <span className="font-normal text-basalt/45">(in this order, up to {MAX_REVIEW_LINKS})</span></span>
        {auto && !links.some((l) => l.platform === "google") && (
          <p className="flex items-center gap-2 border border-basalt/10 bg-chalk/60 px-3 py-2 text-sm">
            <Check className="h-4 w-4 shrink-0 text-sevan" /> Google is added automatically from your Place ID (Integrations → Reviews). Add a Google row to use a different link.
          </p>
        )}
        {links.length === 0 && !auto && <p className="text-sm text-basalt/50">No review sites yet — add one below.</p>}
        {links.map((l, i) => {
          const problem = l.url.trim() ? reviewLinkProblem(l) : null;
          return (
            <div key={i} className="grid gap-2 border border-basalt/12 bg-paper p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
                <select
                  value={l.platform}
                  onChange={(e) => update(i, { platform: e.target.value as ReviewPlatform })}
                  className="h-12 w-full rounded-[0.875rem] border border-basalt/15 bg-paper px-3 text-base"
                  aria-label={`Review site ${i + 1}`}
                >
                  {(Object.keys(REVIEW_PLATFORMS) as ReviewPlatform[]).map((p) => (
                    <option key={p} value={p} disabled={p !== "other" && p !== l.platform && used.has(p)}>{REVIEW_PLATFORMS[p].name}</option>
                  ))}
                </select>
                <Input value={l.url} onChange={(e) => update(i, { url: e.target.value })} placeholder={REVIEW_PLATFORMS[l.platform].hint} className={FIELD} aria-label={`${REVIEW_PLATFORMS[l.platform].name} link`} />
              </div>
              {l.platform === "other" && (
                <Input value={l.label ?? ""} onChange={(e) => update(i, { label: e.target.value })} placeholder="Site name shown on the button, e.g. Yell.am" maxLength={40} className={FIELD} aria-label="Site name" />
              )}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                {problem ? <span className="text-destructive">{problem}</span> : <span className="text-basalt/45">{REVIEW_PLATFORMS[l.platform].hint}</span>}
                <span className="ml-auto flex items-center gap-3">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="font-semibold text-basalt/55 hover:text-basalt disabled:opacity-30">Move up</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === links.length - 1} className="font-semibold text-basalt/55 hover:text-basalt disabled:opacity-30">Move down</button>
                  <button type="button" onClick={() => setLinks(links.filter((_, j) => j !== i))} className="font-semibold text-basalt/55 hover:text-destructive">Remove</button>
                </span>
              </div>
            </div>
          );
        })}
        {links.length < MAX_REVIEW_LINKS && (
          <button type="button" onClick={() => setLinks([...links, { platform: nextPlatform, url: "" }])} className="justify-self-start rounded-full border border-basalt/20 px-4 py-2 text-sm font-semibold hover:border-apricot hover:text-apricot">
            + Add a review site
          </button>
        )}
        <p className="text-xs text-basalt/45">Airbnb, Booking.com, GetYourGuide and Viator only accept reviews from their own bookings, and Yelp forbids asking for reviews — so they aren't offered here.</p>
      </div>

      {buttons.length > 0 && (
        <div className="grid gap-2">
          <span className="text-xs font-semibold text-basalt/55">Guests will see</span>
          <div className="flex flex-wrap gap-2">
            {buttons.map((b) => (
              <span key={b.label + b.url} className="inline-flex min-h-10 items-center rounded-[0.875rem] bg-apricot px-4 text-sm font-semibold text-white">Review on {b.label}</span>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="cj-reply" className="text-sm font-semibold">Guests' email replies go to</Label>
        <Input id="cj-reply" type="email" value={s.reply_to_email} placeholder="you@yourguesthouse.am" onChange={(e) => setS({ ...s, reply_to_email: e.target.value.trim() })} className={FIELD} />
        <p className="text-xs text-basalt/45">Optional. Without it, replies to journey emails don't reach you — guests can still message you in the Revamp inbox.</p>
      </div>
      <div>
        <Button type="button" onClick={() => void save()} disabled={busy} className="h-11 rounded-none bg-apricot px-6 text-white hover:bg-apricot/90">{busy ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}

// ── Guest feedback ──────────────────────────────────────────────────────────

function FeedbackTab() {
  const [rows, setRows] = useState<SurveyAnswer[] | null>(null);
  const [lowOnly, setLowOnly] = useState(false);
  useEffect(() => {
    fetchSurveyAnswers().then(setRows);
  }, []);
  if (!rows) return <p className="text-sm text-basalt/55">Loading…</p>;
  const shown = lowOnly ? rows.filter((r) => r.rating <= 3) : rows;
  const avg = rows.length ? rows.reduce((a, r) => a + r.rating, 0) / rows.length : 0;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-basalt/65">
          {rows.length ? <>{rows.length} answer{rows.length === 1 ? "" : "s"} · average <strong className="tabular-nums">{avg.toFixed(1)}</strong>/5</> : "No answers yet. Turn on a survey in Messages (mid-stay or thank you)."}
        </p>
        {rows.some((r) => r.rating <= 3) && (
          <label className="ml-auto inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="h-4 w-4 accent-[#F15822]" /> Only 1–3 stars
          </label>
        )}
      </div>
      <p className="text-xs text-basalt/45">Private feedback — never published as reviews or ratings.</p>
      <ul className="grid gap-2">
        {shown.map((r) => (
          <li key={r.id} className={cn("border bg-paper p-4", r.rating <= 3 ? "border-tuff/40" : "border-basalt/10")}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="inline-flex" aria-label={`${r.rating} of 5`}>
                {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cn("h-4 w-4", n <= r.rating ? "fill-apricot text-apricot" : "text-basalt/20")} />)}
              </span>
              <span className="font-semibold">{r.guestName}</span>
              <span className="text-basalt/55">{r.listingTitle}</span>
              <span className="text-xs text-basalt/45">{JOURNEY_STEPS[r.step]?.label ?? r.step} · {new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
            </div>
            {r.comment && <p className="mt-2 text-sm leading-6 text-basalt/80">{r.comment}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
