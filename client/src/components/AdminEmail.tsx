/**
 * Admin email broadcast composer. Pick an audience, write a subject + markdown
 * body, preview the recipient count, and send via Resend (server-side). Every
 * email includes an unsubscribe link; recipients on the suppression list are
 * excluded automatically. Past campaigns are logged below.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { adminEmailPreview, adminEmailSend, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const AUDIENCES = [
  { value: "everyone", label: "Everyone" },
  { value: "operators", label: "Operators" },
  { value: "travelers", label: "Registered travelers" },
  { value: "guests", label: "Guests (no account)" },
];

interface CampaignRow { id: string; subject: string; audience: string; recipient_count: number; sent_count: number; created_at: string }

export function AdminEmail() {
  const [audience, setAudience] = useState("everyone");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);

  const loadCampaigns = () => {
    supabase.from("email_campaigns").select("id, subject, audience, recipient_count, sent_count, created_at").order("created_at", { ascending: false }).limit(30).then(({ data }) => setCampaigns((data as CampaignRow[]) ?? []));
  };
  useEffect(loadCampaigns, []);
  useEffect(() => { setPreview(null); }, [audience]);

  const doPreview = async () => {
    setPreviewing(true);
    try {
      setPreview(await adminEmailPreview(audience));
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't preview.");
    } finally {
      setPreviewing(false);
    }
  };

  const doSend = async () => {
    if (!subject.trim() || !body.trim()) return toast("Add a subject and a message.");
    const count = preview?.count;
    const confirmMsg = count != null ? `Send "${subject.trim()}" to ${count} recipient${count === 1 ? "" : "s"}? This can't be undone.` : `Send "${subject.trim()}" to the "${audience}" audience? This can't be undone.`;
    if (!window.confirm(confirmMsg)) return;
    setSending(true);
    try {
      const r = await adminEmailSend({ audience, subject: subject.trim(), body: body.trim() });
      toast.success(`Sent to ${r.sent} of ${r.total}${r.failed ? ` (${r.failed} failed)` : ""}.`);
      setSubject("");
      setBody("");
      setPreview(null);
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
        <h2 className="font-display text-3xl font-normal text-basalt">Email</h2>
        <p className="mt-1 max-w-2xl text-sm text-basalt/55">Send an email to an audience. Recipients who unsubscribed are excluded automatically, and every email includes an unsubscribe link.</p>
      </div>

      <div className="grid max-w-2xl gap-4 border border-basalt/12 bg-paper p-5">
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label className="text-xs font-semibold">Audience</Label>
          <Select value={audience} onValueChange={setAudience}>
            <SelectTrigger className="h-10 rounded-none"><SelectValue /></SelectTrigger>
            <SelectContent>{AUDIENCES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex items-center gap-3">
            <button type="button" onClick={doPreview} disabled={previewing} className="text-xs font-semibold text-apricot hover:underline disabled:opacity-50">{previewing ? "Checking…" : "Preview recipients"}</button>
            {preview && <span className="text-xs text-basalt/55">{preview.count} recipient{preview.count === 1 ? "" : "s"}{preview.sample.length ? ` · e.g. ${preview.sample[0]}` : ""}</span>}
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold">Subject</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A little something from Revamp…" className="h-10 rounded-none" />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold">Message <span className="font-normal text-basalt/45">(Markdown supported)</span></Label>
          <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"Hi there,\n\nWe just added new stays in Dilijan…\n\n[Explore now](https://revampvacations.com/explore)"} className="rounded-none text-base" />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={doSend} disabled={sending} className="rounded-none bg-apricot text-white hover:bg-apricot/90">{sending ? "Sending…" : "Send email"}</Button>
          <span className="text-xs text-basalt/45">Sends immediately to the selected audience.</span>
        </div>
      </div>

      {/* Past campaigns */}
      <div className="grid gap-2">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Sent</h3>
        {campaigns.length === 0 ? (
          <p className="text-sm text-basalt/45">No campaigns yet.</p>
        ) : (
          campaigns.map((c) => (
            <div key={c.id} className={cn("flex flex-wrap items-center justify-between gap-2 border border-basalt/10 bg-paper p-3 text-sm")}>
              <div className="min-w-0">
                <p className="truncate font-semibold text-basalt">{c.subject}</p>
                <p className="text-xs text-basalt/45">{c.audience} · {new Date(c.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
              </div>
              <span className="shrink-0 text-xs text-basalt/55">{c.sent_count}/{c.recipient_count} sent</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
