/**
 * Admin → Campaigns. Two tabs: Compose and Sent. Compose is four numbered steps
 * in one column — 1 Who gets it (channel, audience + live recipient count,
 * CSV import), 2 Message (template, subject, AI draft, body), 3 Visual (email:
 * layout + image library, CampaignVisualPicker), 4 Check & send (full-screen
 * preview at desktop/phone width, send a test, send). EMAIL goes to an audience
 * segment (branded shell, unsubscribe); TELEGRAM to everyone who linked the bot.
 * The preview follows the same layout rules as the server's email builder.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Sparkles, Loader2, Upload, Mail, Send, Eye, X, Monitor, Smartphone, CheckCircle2, AlertCircle, ChevronDown, MousePointerClick } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/lib/supabase";
import { adminEmailPreview, adminEmailSend, adminEmailGenerate, adminEmailImportContacts, adminEmailTest, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { CampaignVisualPicker } from "@/components/CampaignVisualPicker";
import { displaySrc } from "@/lib/campaignImage";
import { httpsUrl, layoutBlocks, layoutHasImage, type CampaignVisual } from "@shared/campaignVisual";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buttonLine, buttonsToText, renderCampaignBody, type ButtonStyle } from "@shared/campaignBlocks";
import { toast } from "sonner";

type Channel = "email" | "telegram";

const AUDIENCES = [
  { value: "everyone", label: "Everyone" },
  { value: "operators", label: "Operators" },
  { value: "travelers", label: "Registered travelers" },
  { value: "guests", label: "Guests (no account)" },
  { value: "contacts", label: "Imported contacts" },
];

const TEMPLATES: { value: string; label: string; subject: string; body: string }[] = [
  { value: "", label: "Start from scratch", subject: "", body: "" },
  {
    value: "new-listings",
    label: "New listings announcement",
    subject: "New places to stay in Armenia ✨",
    body: "Hi {first_name},\n\nWe've just added a fresh set of stays and experiences across Armenia — from Yerevan design apartments to mountain guesthouses in Dilijan.\n\n[[button: Explore what's new | https://revampvacations.com/explore]]\n\nSee you out there,\nThe Revamp team",
  },
  {
    value: "seasonal",
    label: "Seasonal promo",
    subject: "A little something for your next trip",
    body: "Hi {first_name},\n\nAutumn in Armenia is one of our favourite seasons — golden vineyards, crisp mountain air, and fewer crowds.\n\nPlanning a getaway? Browse stays, tours and experiences on Revamp.\n\n[[button: Start planning | https://revampvacations.com]]\n\nWarmly,\nThe Revamp team",
  },
  {
    value: "welcome",
    label: "Welcome / re-engage",
    subject: "Your next Armenian adventure awaits",
    body: "Hi {first_name},\n\nThanks for being part of Revamp. Whether it's a city stay, a day tour, or a hands-on experience, we're here to help you discover Armenia like a local.\n\n[[button: Have a look around | https://revampvacations.com/explore]]\n\nThe Revamp team",
  },
];

interface CampaignRow { id: string; subject: string; audience: string; channel?: string | null; recipient_count: number; sent_count: number; created_at: string }

const previewText = (t: string) => t.replace(/\{\s*(?:first_name|name|guest_first_name)\s*\}/gi, "Anna");

/** Client mirror of server markdownToTelegram: keep line breaks, links as "label (url)". */
const mdToTelegram = (src: string) =>
  buttonsToText(src || "")
    .replace(/\r\n?/g, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/(^|[^_])_([^_]+)_/g, "$1$2")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function AdminEmail() {
  const [tab, setTab] = useState<"compose" | "sent">("compose");
  const [channel, setChannel] = useState<Channel>("email");
  const [audience, setAudience] = useState("everyone");
  const [subject, setSubject] = useState("");
  // Email layout + optional image (0107). "Title · Body" matches what the preview always showed.
  const [visual, setVisual] = useState<CampaignVisual>({ layout: "title_body" });
  const [body, setBody] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  // "Add button" panel (shared/campaignBlocks.ts — a [[button: …]] line in the message).
  const [btnOpen, setBtnOpen] = useState(false);
  const [btnLabel, setBtnLabel] = useState("");
  const [btnUrl, setBtnUrl] = useState("https://revampvacations.com/explore");
  const [btnStyle, setBtnStyle] = useState<ButtonStyle>("solid");
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);
  const [counting, setCounting] = useState(false);
  const [sending, setSending] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [contactCount, setContactCount] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isTg = channel === "telegram";

  // Test send: defaults to the signed-in admin's own inbox and first name.
  const { user, profile } = useAuth();
  const [testTo, setTestTo] = useState("");
  const [testName, setTestName] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (user?.email) setTestTo((v) => v || user.email!);
    if (profile?.displayName) setTestName((v) => v || profile.displayName!.split(/\s+/)[0]);
  }, [user?.email, profile?.displayName]);

  const loadCampaigns = () => {
    supabase.from("email_campaigns").select("id, subject, audience, channel, recipient_count, sent_count, created_at").order("created_at", { ascending: false }).limit(30).then(({ data }) => setCampaigns((data as CampaignRow[]) ?? []));
  };
  const loadContactCount = () => {
    supabase.from("email_contacts").select("email", { count: "exact", head: true }).then(({ count }) => setContactCount(count ?? 0));
  };
  useEffect(() => { loadCampaigns(); loadContactCount(); }, []);

  // Live recipient count — no button to press.
  useEffect(() => {
    let live = true;
    setPreview(null);
    setCounting(true);
    adminEmailPreview(audience, channel)
      .then((r) => live && setPreview(r))
      .catch(() => live && setPreview(null))
      .finally(() => live && setCounting(false));
    return () => {
      live = false;
    };
  }, [audience, channel]);

  const importCsv = async (text: string, source: string) => {
    if (!text.trim()) return toast("That file looks empty.");
    setImporting(true);
    try {
      const r = await adminEmailImportContacts(text, source);
      toast.success(`Imported ${r.imported} contact${r.imported === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} skipped` : ""}. ${r.total} total.`);
      setContactCount(r.total);
      setAudience("contacts");
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't import.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importCsv(String(reader.result || ""), `csv:${file.name}`.slice(0, 120));
    reader.onerror = () => toast("Couldn't read that file.");
    reader.readAsText(file);
  };

  const applyTemplate = (v: string) => {
    const t = TEMPLATES.find((x) => x.value === v);
    if (!t || !t.value) return;
    setSubject(t.subject);
    setBody(t.body);
  };

  const insertTag = () => {
    const el = bodyRef.current;
    const tag = "{first_name}";
    if (!el) { setBody((b) => b + tag); return; }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + tag + body.slice(end));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + tag.length; });
  };

  /** Put a button line at the cursor, on its own line. */
  const insertButton = () => {
    if (!btnLabel.trim()) return toast("Give the button a label, e.g. “Explore stays”.");
    if (!httpsUrl(btnUrl.trim())) return toast("The button link must start with https://");
    const line = buttonLine(btnLabel, btnUrl, btnStyle);
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const before = body.slice(0, start).replace(/[ \t]*$/, "");
    const after = body.slice(end).replace(/^[ \t]*/, "");
    const pre = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const post = after && !after.startsWith("\n") ? "\n\n" : "";
    const next = `${before}${pre}${line}${post}${after}`;
    setBody(next);
    setBtnOpen(false);
    setBtnLabel("");
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = (before + pre + line).length;
    });
  };

  const generate = async () => {
    if (!prompt.trim()) return toast("Describe the message you want.");
    setGenerating(true);
    try {
      const r = await adminEmailGenerate(prompt.trim());
      setBody(r.body);
      toast.success("Draft ready — edit it as you like.");
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't draft that.");
    } finally {
      setGenerating(false);
    }
  };

  /** The visual to send, or an error message. An image layout without an image is sent without one. */
  const cleanVisual = (): CampaignVisual | string => {
    const link = (visual.imageLink ?? "").trim();
    if (link && !httpsUrl(link)) return "The image link must be a full address starting with https://";
    const withImg = layoutHasImage(visual.layout) && !!visual.imageUrl;
    return {
      layout: layoutHasImage(visual.layout) && !visual.imageUrl ? "title_body" : visual.layout,
      imageUrl: withImg ? visual.imageUrl : null,
      imageLink: withImg && link ? link : null,
      imageAlt: withImg ? (visual.imageAlt ?? "").trim() || null : null,
    };
  };

  const sendTest = async () => {
    const to = testTo.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!subject.trim() || !body.trim()) return setTestResult({ ok: false, text: "Add a subject and a message first (step 2)." });
    if (!to.length) return setTestResult({ ok: false, text: "Add an email address to send the test to." });
    const v = cleanVisual();
    if (typeof v === "string") return setTestResult({ ok: false, text: v });
    setTesting(true);
    setTestResult(null);
    try {
      const r = await adminEmailTest({ subject, body, to, name: testName.trim() || undefined, visual: v });
      const at = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      setTestResult({
        ok: true,
        text: `Sent at ${at} to ${to.join(", ")}${r.from ? ` from ${r.from}` : ""}. Look for "[TEST] ${subject.trim()}" — if it isn't in the inbox within a minute, check Spam and Promotions.`,
      });
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof ApiError ? e.message : "Couldn't send the test." });
    } finally {
      setTesting(false);
    }
  };

  const doSend = async () => {
    if (!subject.trim() || !body.trim()) return toast("Add a subject and a message.");
    const count = preview?.count;
    const who = isTg ? "linked Telegram chat" : "recipient";
    const target = isTg ? "as a Telegram broadcast" : `to the "${audience}" audience`;
    const msg = count != null
      ? `Send "${subject.trim()}" to ${count} ${who}${count === 1 ? "" : "s"}? This can't be undone.`
      : `Send "${subject.trim()}" ${target}? This can't be undone.`;
    const v = cleanVisual();
    if (!isTg && typeof v === "string") return toast(v);
    if (!isTg && layoutHasImage(visual.layout) && !visual.imageUrl && !window.confirm("This layout has no image chosen — send it as Title · Body?")) return;
    if (!window.confirm(msg)) return;
    setSending(true);
    try {
      const r = await adminEmailSend({ audience, subject: subject.trim(), body: body.trim(), channel, ...(!isTg && typeof v !== "string" ? { visual: v } : {}) });
      toast.success(`Sent to ${r.sent} of ${r.total}${r.failed ? ` (${r.failed} failed)` : ""}.`);
      setSubject(""); setBody(""); setPrompt(""); setVisual({ layout: "title_body" }); setTestResult(null);
      loadCampaigns();
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't send.");
    } finally {
      setSending(false);
    }
  };

  const countLabel = counting
    ? "Counting…"
    : preview
      ? `${preview.count.toLocaleString("en-US")} ${isTg ? "linked Telegram chat" : "recipient"}${preview.count === 1 ? "" : "s"}`
      : null;

  return (
    <div className="grid gap-5">
      <PageHeader
        className="mb-0"
        title="Campaigns"
        sub="Email or Telegram broadcasts. Unsubscribed people are always left out."
        actions={
          <div className="inline-flex gap-1 rounded-full border border-basalt/12 bg-chalk/40 p-1" role="tablist" aria-label="Campaigns">
            {([["compose", "Compose"], ["sent", `Sent${campaigns.length ? ` (${campaigns.length})` : ""}`]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn("rounded-full px-4 py-1.5 text-sm font-semibold transition", tab === k ? "bg-basalt text-paper" : "text-basalt/55 hover:text-basalt")}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {tab === "sent" ? (
        <div className="grid max-w-3xl gap-2">
          {campaigns.length === 0 ? (
            <div className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">No campaigns sent yet.</div>
          ) : (
            campaigns.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border border-basalt/10 bg-paper p-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-basalt">{c.subject}</p>
                  <p className="text-xs text-basalt/45"><span className="uppercase">{c.channel || "email"}</span> · {c.audience} · {new Date(c.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                </div>
                <span className="shrink-0 text-xs text-basalt/55">{c.sent_count}/{c.recipient_count} sent</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="grid max-w-3xl gap-5">
          {/* 1 — Who gets it */}
          <Step n={1} title="Who gets it">
            <div className="grid gap-4">
              <div className="inline-flex w-fit gap-1 border border-basalt/12 bg-chalk/40 p-1">
                {([["email", "Email", Mail], ["telegram", "Telegram", Send]] as const).map(([val, label, Icon]) => (
                  <button
                    key={val}
                    type="button"
                    aria-pressed={channel === val}
                    onClick={() => setChannel(val)}
                    className={cn("flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold transition", channel === val ? "bg-paper text-basalt shadow-sm" : "text-basalt/50 hover:text-basalt/80")}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cm-audience" className="text-xs font-semibold">Audience</Label>
                <div className="flex flex-wrap items-center gap-3">
                  {isTg ? (
                    <div className="flex h-10 items-center border border-basalt/12 bg-chalk/40 px-3 text-sm text-basalt/60">Everyone who linked the Revamp bot</div>
                  ) : (
                    <Select value={audience} onValueChange={setAudience}>
                      <SelectTrigger id="cm-audience" className="h-10 w-full rounded-none sm:w-64"><SelectValue /></SelectTrigger>
                      <SelectContent>{AUDIENCES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  {countLabel && <span className={cn("text-sm", preview?.count === 0 ? "font-semibold text-apricot" : "text-basalt/60")}>{countLabel}</span>}
                </div>
                {preview?.sample[0] && !isTg && <p className="text-xs text-basalt/45">e.g. {preview.sample[0]}</p>}
              </div>
              {!isTg && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-basalt/55">
                  <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" onChange={onFile} className="hidden" />
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className="inline-flex items-center gap-1.5 font-semibold text-apricot hover:underline disabled:opacity-50">
                    {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Import contacts from a CSV
                  </button>
                  <span>
                    {contactCount != null ? `${contactCount} on file · ` : ""}needs a column named <code className="text-basalt/70">email</code> (and optionally <code className="text-basalt/70">name</code>).
                  </span>
                </div>
              )}
            </div>
          </Step>

          {/* 2 — Message */}
          <Step
            n={2}
            title="Message"
            actions={
              <Select onValueChange={applyTemplate}>
                <SelectTrigger className="h-9 w-52 rounded-none text-sm"><SelectValue placeholder="Start from a template…" /></SelectTrigger>
                <SelectContent>{TEMPLATES.map((t) => <SelectItem key={t.value || "scratch"} value={t.value || "scratch"}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            }
          >
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="cm-subject" className="text-xs font-semibold">{isTg ? "First line" : "Subject"}</Label>
                <Input id="cm-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={isTg ? "New stays just landed on Revamp" : "A little something from Revamp…"} className="h-10 rounded-none" />
                <p className="text-xs text-basalt/45">{"{first_name}"} works here too.</p>
              </div>

              <div className="grid gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="cm-body" className="text-xs font-semibold">Message <span className="font-normal text-basalt/45">(Markdown{isTg ? " — plain text on Telegram" : ""})</span></Label>
                  <div className="flex flex-wrap items-center gap-4">
                    {!isTg && (
                      <button type="button" onClick={() => setBtnOpen((o) => !o)} aria-expanded={btnOpen} className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/65 hover:text-apricot">
                        <MousePointerClick className="h-3.5 w-3.5 text-apricot" /> Add button
                      </button>
                    )}
                    <button type="button" onClick={() => setAiOpen((o) => !o)} aria-expanded={aiOpen} className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/65 hover:text-apricot">
                      <Sparkles className="h-3.5 w-3.5 text-apricot" /> Draft with AI <ChevronDown className={cn("h-3 w-3 transition-transform", aiOpen && "rotate-180")} />
                    </button>
                    <button type="button" onClick={insertTag} className="text-xs font-semibold text-apricot hover:underline">Insert {"{first_name}"}</button>
                  </div>
                </div>
                {aiOpen && (
                  <div className="grid gap-2 border border-basalt/10 bg-chalk/50 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Announce new Dilijan stays, warm and short, with a link to explore" className="h-10 rounded-none" aria-label="What should the message say?" />
                    <Button type="button" onClick={generate} disabled={generating} className="h-10 rounded-none bg-basalt text-paper hover:bg-basalt/90">{generating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Write it"}</Button>
                  </div>
                )}
                {btnOpen && !isTg && (
                  <div className="grid gap-3 border border-basalt/10 bg-chalk/50 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor="btn-label" className="text-xs font-semibold">Button text</Label>
                        <Input id="btn-label" value={btnLabel} onChange={(e) => setBtnLabel(e.target.value)} maxLength={40} placeholder="Explore stays" className="h-10 rounded-none bg-paper" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="btn-url" className="text-xs font-semibold">Link</Label>
                        <Input id="btn-url" type="url" value={btnUrl} onChange={(e) => setBtnUrl(e.target.value)} placeholder="https://revampvacations.com/explore" className="h-10 rounded-none bg-paper" />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="inline-flex gap-1 border border-basalt/12 bg-paper p-1" role="group" aria-label="Button style">
                        {([["solid", "Solid"], ["outline", "Outline"]] as const).map(([k, l]) => (
                          <button key={k} type="button" aria-pressed={btnStyle === k} onClick={() => setBtnStyle(k)} className={cn("px-3 py-1 text-xs font-semibold", btnStyle === k ? "bg-basalt text-paper" : "text-basalt/55 hover:text-basalt")}>{l}</button>
                        ))}
                      </div>
                      <Button type="button" onClick={insertButton} className="h-9 rounded-none bg-basalt text-paper hover:bg-basalt/90">Insert at cursor</Button>
                    </div>
                    <p className="text-xs text-basalt/50">It shows in the message as a <code>[[button: …]]</code> line — edit or delete that line to change it. Buttons are centred; one or two per email work best.</p>
                  </div>
                )}
                <Textarea id="cm-body" ref={bodyRef} rows={12} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"Hi {first_name},\n\nWe just added new stays in Dilijan…\n\n[Explore now](https://revampvacations.com/explore)"} className="rounded-none text-base" />
              </div>
            </div>
          </Step>

          {/* 3 — Visual (email only) */}
          {!isTg && (
            <Step n={3} title="Visual" sub="Optional. Pick a layout, then an image from your library or the starters.">
              <CampaignVisualPicker value={visual} onChange={setVisual} />
            </Step>
          )}

          {/* 4 — Check & send */}
          <Step n={isTg ? 3 : 4} title="Check & send">
            <div className="grid gap-5">
              <div>
                <Button type="button" variant="outline" onClick={() => setShowPreview(true)} className="h-10 rounded-none border-basalt/25">
                  <Eye className="mr-2 h-4 w-4" /> Preview {isTg ? "message" : "email"}
                </Button>
              </div>

              {!isTg && (
                <div className="grid gap-3 border border-basalt/10 bg-chalk/40 p-4">
                  <div>
                    <p className="text-sm font-semibold text-basalt">Send a test</p>
                    <p className="text-xs text-basalt/55">Exactly what recipients get, with [TEST] in the subject. Not recorded as a campaign.</p>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="test-to" className="text-xs font-semibold">Send to</Label>
                    <Input id="test-to" type="text" inputMode="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@revampvacations.com" className="h-10 rounded-none bg-paper" />
                    <p className="text-xs text-basalt/45">Up to 5 addresses, separated by commas.</p>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="grid w-full gap-1.5 sm:w-56">
                      <Label htmlFor="test-name" className="text-xs font-semibold">Name used for {"{first_name}"}</Label>
                      <Input id="test-name" value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="Anna" className="h-10 rounded-none bg-paper" />
                    </div>
                    <Button type="button" variant="outline" onClick={sendTest} disabled={testing} className="h-10 rounded-none border-basalt/25 bg-paper">
                      {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-1.5 h-3.5 w-3.5" /> Send test</>}
                    </Button>
                  </div>
                  {testResult && (
                    <p role="status" className={cn("flex items-start gap-2 text-sm leading-6", testResult.ok ? "text-basalt/75" : "text-apricot")}>
                      {testResult.ok ? <CheckCircle2 className="mt-1 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-1 h-4 w-4 shrink-0" />}
                      <span>{testResult.text}</span>
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 border-t border-basalt/10 pt-5">
                <Button onClick={doSend} disabled={sending || preview?.count === 0} className="h-11 rounded-none bg-apricot px-6 text-white hover:bg-apricot/90">
                  {sending ? "Sending…" : isTg ? "Send Telegram broadcast" : preview ? `Send to ${preview.count.toLocaleString("en-US")} recipient${preview.count === 1 ? "" : "s"}` : "Send email"}
                </Button>
                {preview?.count === 0 && <span className="text-sm text-basalt/55">No one is in this audience yet.</span>}
              </div>
            </div>
          </Step>
        </div>
      )}

      {showPreview && (
        <PreviewOverlay onClose={() => setShowPreview(false)} isTg={isTg} subject={subject} body={body} visual={visual} />
      )}
    </div>
  );
}

/** A numbered composer step: the number encodes the order you work in. */
function Step({ n, title, sub, actions, children }: { n: number; title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-basalt/12 bg-paper p-5 sm:p-6" aria-labelledby={`step-${n}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-basalt text-xs font-bold text-paper" aria-hidden>{n}</span>
          <div>
            <h2 id={`step-${n}`} className="text-base font-semibold leading-6 text-basalt">{title}</h2>
            {sub && <p className="text-sm text-basalt/55">{sub}</p>}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Full-screen preview at desktop or phone width — the same layout the server sends. */
function PreviewOverlay({ onClose, isTg, subject, body, visual }: { onClose: () => void; isTg: boolean; subject: string; body: string; visual: CampaignVisual }) {
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#F5F2EC]" role="dialog" aria-modal="true" aria-label="Preview">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-basalt/10 bg-paper px-4 py-3 sm:px-6">
        <p className="min-w-0 text-sm font-semibold text-basalt">Preview <span className="hidden font-normal text-basalt/50 sm:inline">· {"{first_name}"} shown as “Anna”</span></p>
        <div className="flex shrink-0 items-center gap-2">
          <div className="inline-flex gap-1 rounded-full border border-basalt/12 bg-chalk/40 p-1">
            {([["desktop", "Desktop", Monitor], ["phone", "Phone", Smartphone]] as const).map(([k, label, Icon]) => (
              <button
                key={k}
                type="button"
                aria-pressed={device === k}
                onClick={() => setDevice(k)}
                className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold", device === k ? "bg-basalt text-paper" : "text-basalt/55 hover:text-basalt")}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> <span className="sr-only sm:not-sr-only">{label}</span>
              </button>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose} aria-label="Close preview" className="h-8 rounded-none border-basalt/20 px-2 sm:px-3">
            <X className="h-4 w-4 sm:mr-1" aria-hidden /> <span className="hidden sm:inline">Close</span>
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-4 py-8">
        <div className="mx-auto transition-[max-width]" style={{ maxWidth: device === "phone" ? 375 : 640 }}>
          {!isTg && (
            <div className="mb-3 border border-basalt/10 bg-paper px-4 py-3 text-sm">
              <p className="text-xs text-basalt/45">Subject</p>
              <p className="font-semibold text-basalt">{previewText(subject) || "Your subject"}</p>
            </div>
          )}
          {isTg ? <TelegramPreview subject={subject} body={body} /> : <EmailPreview subject={subject} body={body} visual={visual} />}
        </div>
      </div>
    </div>
  );
}

function TelegramPreview({ subject, body }: { subject: string; body: string }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-basalt/12 bg-[#cfe0ed] p-4">
      <div className="max-w-[85%] rounded-[14px] rounded-tl-sm bg-white px-4 py-3 shadow-sm">
        {subject.trim() && <p className="whitespace-pre-wrap text-sm font-semibold text-basalt">{previewText(subject)}</p>}
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-basalt/85">{body.trim() ? previewText(mdToTelegram(body)) : "Your message will appear here."}</p>
        <p className="mt-1 text-right text-[10px] text-basalt/35">Revamp bot</p>
      </div>
      <p className="mt-2 text-center text-[11px] text-basalt/45">Sent as plain text. Links show as “label (url)” and Telegram makes them tappable.</p>
    </div>
  );
}

function EmailPreview({ subject, body, visual }: { subject: string; body: string; visual: CampaignVisual }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-basalt/10 bg-white">
      <div className="border-b border-basalt/8 px-6 py-4"><span className="font-display text-xl">revamp.</span></div>
      <div className="grid gap-3 px-6 py-5">
        {/* Same order as the email the server builds (shared/campaignVisual.ts). */}
        {layoutBlocks(visual.layout).map((b) =>
          b === "title" ? (
            <p key="t" className="font-display text-2xl leading-tight text-basalt">{previewText(subject) || "Subject"}</p>
          ) : b === "image" ? (
            visual.imageUrl ? (
              <img key="i" src={displaySrc(visual.imageUrl)} alt={visual.imageAlt ?? ""} className="w-full rounded-[10px]" />
            ) : (
              <div key="i" className="grid aspect-[2/1] w-full place-items-center rounded-[10px] border border-dashed border-basalt/20 bg-chalk text-xs text-basalt/45">No image chosen — sent as Title · Body</div>
            )
          ) : (
            <div
              key="b"
              className="prose-blog text-[15px] leading-7 text-basalt/80 [&_a]:text-apricot [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: body.trim() ? renderCampaignBody(previewText(body)) : "<p style='color:#9a958c'>The body text will be displayed here.</p>" }}
            />
          ),
        )}
      </div>
      <div className="border-t border-basalt/8 px-6 py-3 text-[11px] text-basalt/45">
        Revamp Vacations · revampvacations.com · Sent {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}<br />Don't want these emails? <span className="underline">Unsubscribe</span>.
      </div>
    </div>
  );
}
