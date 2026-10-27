/**
 * Operator settings: message templates (reusable canned replies) + an automatic
 * initial message sent to a guest's first message (migration 0082). Templates are
 * inserted from the inbox composer; the auto-reply fires server-side in
 * /api/message-send. Lives in Dashboard → Settings.
 */
import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { listTemplates, createTemplate, deleteTemplate, getAutoReply, setAutoReply, getAiReply, setAiReply, type AiReplySettings, type MessageTemplate } from "@/lib/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function MessageTemplatesSettings() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoMsg, setAutoMsg] = useState("");
  const [autoSaving, setAutoSaving] = useState(false);

  // Aha automatic answers (0119). null = not available yet (migration not run).
  const [ai, setAi] = useState<AiReplySettings | null>(null);
  const [aiSaving, setAiSaving] = useState(false);

  const reload = () => { if (user) listTemplates(user.id).then(setTemplates); };
  useEffect(() => {
    if (!user) return;
    listTemplates(user.id).then(setTemplates);
    getAutoReply(user.id).then((s) => { setAutoEnabled(s.enabled); setAutoMsg(s.message); });
    getAiReply(user.id).then(setAi).catch(() => setAi(null));
  }, [user]);

  const saveAi = async (next: AiReplySettings) => {
    if (!user) return;
    setAi(next);
    setAiSaving(true);
    try {
      await setAiReply(user.id, next);
      toast.success(next.auto ? `Aha will answer guests after ${next.delayMinutes} minutes when your listing has the answer.` : "Aha automatic answers are off.");
    } catch (e) {
      console.error(e);
      toast("Couldn't save that. Please try again.");
    } finally {
      setAiSaving(false);
    }
  };

  const add = async () => {
    if (!user) return;
    if (!title.trim() || !body.trim()) return toast("Give the template a name and a message.");
    setSaving(true);
    try { await createTemplate(user.id, title, body); setTitle(""); setBody(""); reload(); toast.success("Template saved."); }
    catch (e) { toast(e instanceof Error ? e.message : "Couldn't save."); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    try { await deleteTemplate(id); reload(); } catch (e) { toast(e instanceof Error ? e.message : "Couldn't delete."); }
  };

  const saveAuto = async () => {
    if (!user) return;
    if (autoEnabled && !autoMsg.trim()) return toast("Write the auto-reply message, or turn it off.");
    setAutoSaving(true);
    try { await setAutoReply(user.id, { enabled: autoEnabled, message: autoMsg }); toast.success("Auto-reply saved."); }
    catch (e) { toast(e instanceof Error ? e.message : "Couldn't save."); }
    finally { setAutoSaving(false); }
  };

  return (
    <div className="grid gap-8">
      {/* Aha answers (0119) */}
      {ai && (
        <div className="border border-basalt/12 bg-paper p-5">
          <h3 className="flex items-center gap-2 font-display text-xl font-normal text-basalt"><Sparkles className="h-4 w-4 text-apricot" /> Aha answers guests</h3>
          <p className="mt-1 max-w-2xl text-sm text-basalt/55">
            When a guest's message waits without a reply, Aha answers it — only if your listing details or Guest FAQ have the answer, in the guest's language, labelled as Aha. Booking changes, cancellations, payments, complaints and anything it isn't sure of stay with you. You can always use “Suggest a reply” in the inbox.
          </p>
          <label className="mt-4 flex min-h-11 items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={ai.auto} disabled={aiSaving} onChange={(e) => saveAi({ ...ai, auto: e.target.checked })} className="h-5 w-5 accent-[#F15822]" />
            Let Aha answer when I haven't replied
          </label>
          <label className="mt-2 flex flex-wrap items-center gap-3 text-sm text-basalt/70">
            Answer after
            <select
              value={ai.delayMinutes}
              disabled={!ai.auto || aiSaving}
              onChange={(e) => saveAi({ ...ai, delayMinutes: Number(e.target.value) })}
              className="h-12 rounded-none border border-basalt/15 bg-paper px-3 text-base disabled:opacity-50 sm:h-10 sm:text-sm"
            >
              {[5, 15, 30, 60, 120].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? "" : "s"}`}
                </option>
              ))}
            </select>
            without a reply from you
          </label>
        </div>
      )}

      {/* Auto-reply */}
      <div className="border border-basalt/12 bg-paper p-5">
        <h3 className="flex items-center gap-2 font-display text-xl font-normal text-basalt"><Sparkles className="h-4 w-4 text-apricot" /> Automatic first reply</h3>
        <p className="mt-1 max-w-2xl text-sm text-basalt/55">Sent the instant a guest opens a conversation, so nobody waits. It doesn't count as your reply in Response metrics — follow up personally when you can.</p>
        <label className="mt-4 flex min-h-11 items-center gap-3 text-sm font-semibold">
          <input type="checkbox" checked={autoEnabled} onChange={(e) => setAutoEnabled(e.target.checked)} className="h-5 w-5 accent-[#F15822]" />
          Send an automatic first reply
        </label>
        <Textarea
          value={autoMsg}
          onChange={(e) => setAutoMsg(e.target.value)}
          rows={3}
          disabled={!autoEnabled}
          placeholder="Hi! Thanks for reaching out — we usually reply within an hour. Meanwhile, feel free to share your dates and group size."
          className="mt-3 rounded-none disabled:opacity-50"
        />
        <Button onClick={saveAuto} disabled={autoSaving} className="mt-3 h-11 rounded-none bg-apricot text-white hover:bg-apricot/90">{autoSaving ? "Saving…" : "Save auto-reply"}</Button>
      </div>

      {/* Templates */}
      <div className="border border-basalt/12 bg-paper p-5">
        <h3 className="font-display text-xl font-normal text-basalt">Message templates</h3>
        <p className="mt-1 max-w-2xl text-sm text-basalt/55">Save canned replies and insert them with one tap from the inbox — check-in details, directions, house rules, and so on.</p>

        <div className="mt-4 grid gap-2 border border-basalt/10 bg-chalk/40 p-3">
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">Template name</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Check-in details" className="h-12 rounded-none" />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">Message</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Check-in is from 3pm. The keybox code is… Parking is available on-site." className="rounded-none" />
          </div>
          <Button onClick={add} disabled={saving} className="h-11 justify-self-start rounded-none bg-basalt text-paper hover:bg-basalt/90">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="mr-1.5 h-4 w-4" /> Add template</>}</Button>
        </div>

        <div className="mt-4 grid gap-2">
          {templates === null ? (
            <div className="grid place-items-center py-6 text-basalt/40"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : templates.length === 0 ? (
            <p className="text-sm text-basalt/45">No templates yet.</p>
          ) : templates.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-3 border border-basalt/10 bg-paper p-3">
              <div className="min-w-0">
                <p className="font-semibold text-basalt">{t.title}</p>
                <p className="mt-0.5 line-clamp-2 text-sm text-basalt/55">{t.body}</p>
              </div>
              <button
                type="button"
                onClick={() => window.confirm(`Delete the template "${t.title}"?`) && remove(t.id)}
                className="-m-2 grid h-10 w-10 shrink-0 place-items-center text-basalt/40 hover:text-red-500"
                aria-label={`Delete template ${t.title}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
