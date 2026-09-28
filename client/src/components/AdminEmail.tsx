/**
 * Admin broadcast composer with a live preview. Send over EMAIL (to an audience
 * segment, branded shell, unsubscribe) or TELEGRAM (to everyone who linked the
 * bot — linking is the opt-in). Start from a template or draft with AI,
 * personalize with {first_name}, and see exactly how it will look before sending.
 */
import { useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, Upload, Mail, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { adminEmailPreview, adminEmailSend, adminEmailGenerate, adminEmailImportContacts, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { renderMarkdown } from "@shared/markdown";
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
    body: "Hi {first_name},\n\nWe've just added a fresh set of stays and experiences across Armenia — from Yerevan design apartments to mountain guesthouses in Dilijan.\n\n[Explore what's new](https://revampvacations.com/explore)\n\nSee you out there,\nThe Revamp team",
  },
  {
    value: "seasonal",
    label: "Seasonal promo",
    subject: "A little something for your next trip",
    body: "Hi {first_name},\n\nAutumn in Armenia is one of our favourite seasons — golden vineyards, crisp mountain air, and fewer crowds.\n\nPlanning a getaway? Browse stays, tours and experiences on Revamp.\n\n[Start planning](https://revampvacations.com)\n\nWarmly,\nThe Revamp team",
  },
  {
    value: "welcome",
    label: "Welcome / re-engage",
    subject: "Your next Armenian adventure awaits",
    body: "Hi {first_name},\n\nThanks for being part of Revamp. Whether it's a city stay, a day tour, or a hands-on experience, we're here to help you discover Armenia like a local.\n\n[Have a look around](https://revampvacations.com/explore)\n\nThe Revamp team",
  },
];

interface CampaignRow { id: string; subject: string; audience: string; channel?: string | null; recipient_count: number; sent_count: number; created_at: string }

const previewText = (t: string) => t.replace(/\{\s*(?:first_name|name|guest_first_name)\s*\}/gi, "Anna");

/** Client mirror of server markdownToTelegram: keep line breaks, links as "label (url)". */
const mdToTelegram = (src: string) =>
  (src || "")
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
  const [channel, setChannel] = useState<Channel>("email");
  const [audience, setAudience] = useState("everyone");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [contactCount, setContactCount] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isTg = channel === "telegram";

  const loadCampaigns = () => {
    supabase.from("email_campaigns").select("id, subject, audience, channel, recipient_count, sent_count, created_at").order("created_at", { ascending: false }).limit(30).then(({ data }) => setCampaigns((data as CampaignRow[]) ?? []));
  };
  const loadContactCount = () => {
    supabase.from("email_contacts").select("email", { count: "exact", head: true }).then(({ count }) => setContactCount(count ?? 0));
  };
  useEffect(() => { loadCampaigns(); loadContactCount(); }, []);
  useEffect(() => { setPreview(null); }, [audience, channel]);

  const importCsv = async (text: string, source: string) => {
    if (!text.trim()) return toast("That file looks empty.");
    setImporting(true);
    try {
      const r = await adminEmailImportContacts(text, source);
      toast.success(`Imported ${r.imported} contact${r.imported === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} skipped` : ""}. ${r.total} total.`);
      setContactCount(r.total);
      setAudience("contacts");
      setPreview(null);
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

  const doPreview = async () => {
    setPreviewing(true);
    try { setPreview(await adminEmailPreview(audience, channel)); }
    catch (e) { toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't preview."); }
    finally { setPreviewing(false); }
  };

  const doSend = async () => {
    if (!subject.trim() || !body.trim()) return toast("Add a subject and a message.");
    const count = preview?.count;
    const who = isTg ? "linked Telegram chat" : "recipient";
    const target = isTg ? "as a Telegram broadcast" : `to the "${audience}" audience`;
    const msg = count != null
      ? `Send "${subject.trim()}" to ${count} ${who}${count === 1 ? "" : "s"}? This can't be undone.`
      : `Send "${subject.trim()}" ${target}? This can't be undone.`;
    if (!window.confirm(msg)) return;
    setSending(true);
    try {
      const r = await adminEmailSend({ audience, subject: subject.trim(), body: body.trim(), channel });
      toast.success(`Sent to ${r.sent} of ${r.total}${r.failed ? ` (${r.failed} failed)` : ""}.`);
      setSubject(""); setBody(""); setPrompt(""); setPreview(null);
      loadCampaigns();
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't send.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="font-display text-3xl font-normal text-basalt">Campaigns</h2>
        <p className="mt-1 max-w-2xl text-sm text-basalt/55">Compose a message, preview it, and send it over email or Telegram. {isTg ? "Telegram goes to everyone who linked the Revamp bot." : "Unsubscribed recipients are excluded automatically."}</p>
      </div>

      {/* Channel toggle */}
      <div className="inline-flex w-fit gap-1 border border-basalt/12 bg-chalk/40 p-1">
        {([["email", "Email", Mail], ["telegram", "Telegram", Send]] as const).map(([val, label, Icon]) => (
          <button
            key={val}
            type="button"
            onClick={() => setChannel(val)}
            className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold transition ${channel === val ? "bg-paper text-basalt shadow-sm" : "text-basalt/50 hover:text-basalt/80"}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        {/* Composer */}
        <div className="grid gap-4 border border-basalt/12 bg-paper p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {isTg ? (
              <div className="grid gap-1.5 sm:col-span-1">
                <Label className="text-xs font-semibold">Audience</Label>
                <div className="flex h-10 items-center border border-basalt/12 bg-chalk/40 px-3 text-sm text-basalt/60">Everyone who linked Telegram</div>
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Audience</Label>
                <Select value={audience} onValueChange={setAudience}>
                  <SelectTrigger className="h-10 rounded-none"><SelectValue /></SelectTrigger>
                  <SelectContent>{AUDIENCES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Start from a template</Label>
              <Select onValueChange={applyTemplate}>
                <SelectTrigger className="h-10 rounded-none"><SelectValue placeholder="Choose a template…" /></SelectTrigger>
                <SelectContent>{TEMPLATES.map((t) => <SelectItem key={t.value || "scratch"} value={t.value || "scratch"}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {/* Import contacts (email only) */}
          {!isTg && (
            <div className="flex flex-wrap items-center gap-3 border border-dashed border-basalt/20 bg-chalk/40 p-3">
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" onChange={onFile} className="hidden" />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={importing} className="h-9 rounded-none">
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="mr-1.5 h-4 w-4" /> Import contacts (CSV)</>}
              </Button>
              <span className="text-xs text-basalt/55">
                {contactCount != null ? `${contactCount} imported contact${contactCount === 1 ? "" : "s"} on file. ` : ""}
                A column named <code className="text-basalt/70">email</code> (and optionally <code className="text-basalt/70">name</code>). Export from Excel as CSV.
              </span>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">{isTg ? "First line" : "Subject"} <span className="font-normal text-basalt/45">({"{first_name}"} works here too)</span></Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={isTg ? "New stays just landed on Revamp" : "A little something from Revamp…"} className="h-10 rounded-none" />
          </div>

          {/* AI draft */}
          <div className="grid gap-1.5 border border-basalt/10 bg-chalk/50 p-3">
            <Label className="flex items-center gap-1.5 text-xs font-semibold text-basalt/70"><Sparkles className="h-3.5 w-3.5 text-apricot" /> Draft with AI</Label>
            <div className="flex gap-2">
              <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Announce new Dilijan stays, warm and short, with a link to explore" className="h-10 flex-1 rounded-none" />
              <Button type="button" onClick={generate} disabled={generating} className="h-10 shrink-0 rounded-none bg-basalt text-paper hover:bg-basalt/90">{generating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate"}</Button>
            </div>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Message <span className="font-normal text-basalt/45">(Markdown{isTg ? " — shown as plain text on Telegram" : ""})</span></Label>
              <button type="button" onClick={insertTag} className="text-[11px] font-semibold text-apricot hover:underline">Insert {"{first_name}"}</button>
            </div>
            <Textarea ref={bodyRef} rows={12} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"Hi {first_name},\n\nWe just added new stays in Dilijan…\n\n[Explore now](https://revampvacations.com/explore)"} className="rounded-none text-base" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={doSend} disabled={sending} className="rounded-none bg-apricot text-white hover:bg-apricot/90">{sending ? "Sending…" : isTg ? "Send Telegram broadcast" : "Send email"}</Button>
            <button type="button" onClick={doPreview} disabled={previewing} className="text-xs font-semibold text-apricot hover:underline disabled:opacity-50">{previewing ? "Checking…" : "Check recipient count"}</button>
            {preview && <span className="text-xs text-basalt/55">{preview.count} {isTg ? "linked Telegram chat" : "recipient"}{preview.count === 1 ? "" : "s"}{preview.sample.length ? ` · e.g. ${preview.sample[0]}` : ""}</span>}
          </div>
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-[88px] lg:self-start">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">Preview</p>
          {isTg ? (
            <div className="overflow-hidden rounded-[14px] border border-basalt/12 bg-[#cfe0ed] p-4">
              <div className="max-w-[80%] rounded-[14px] rounded-tl-sm bg-white px-4 py-3 shadow-sm">
                {subject.trim() && <p className="whitespace-pre-wrap text-sm font-semibold text-basalt">{previewText(subject)}</p>}
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-basalt/85">{body.trim() ? previewText(mdToTelegram(body)) : "Your message will appear here."}</p>
                <p className="mt-1 text-right text-[10px] text-basalt/35">Revamp bot</p>
              </div>
              <p className="mt-2 text-center text-[11px] text-basalt/45">Sent as plain text. Links show as “label (url)” and Telegram makes them tappable.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[14px] border border-basalt/12 bg-[#F5F2EC] p-4">
              <div className="mx-auto max-w-[600px] overflow-hidden rounded-[14px] border border-basalt/10 bg-white">
                <div className="border-b border-basalt/8 px-6 py-4"><span className="font-display text-xl">revamp<span style={{ color: "#F15822" }}>.</span></span></div>
                <div className="px-6 py-4">
                  <p className="font-display text-2xl leading-tight text-basalt">{previewText(subject) || "Subject"}</p>
                  <div
                    className="prose-blog mt-3 text-sm leading-6 text-basalt/80 [&_a]:text-apricot [&_a]:underline"
                    dangerouslySetInnerHTML={{ __html: body.trim() ? renderMarkdown(previewText(body)) : "<p style='color:#9a958c'>The body text will be displayed here.</p>" }}
                  />
                </div>
                <div className="border-t border-basalt/8 px-6 py-3 text-[11px] text-basalt/45">
                  Revamp Vacations · revampvacations.com · Sent {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}<br />Don't want these emails? <span className="underline">Unsubscribe</span>.
                </div>
              </div>
              <p className="mt-2 text-center text-[11px] text-basalt/40">{"{first_name}"} shown as “Anna” — replaced per recipient at send.</p>
            </div>
          )}
        </div>
      </div>

      {/* Past campaigns */}
      <div className="grid gap-2">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Sent</h3>
        {campaigns.length === 0 ? (
          <p className="text-sm text-basalt/45">No campaigns yet.</p>
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
    </div>
  );
}
