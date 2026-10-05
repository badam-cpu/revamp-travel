/**
 * Dashboard → Documents (operator). Shows documents Revamp has shared with the
 * operator (contracts, policies, guides) plus the operator's own uploads, all
 * viewable inline (DocumentViewerDialog) or downloadable. Operators can upload
 * their own files (signed agreements, licenses, IDs) — stored as their own docs,
 * visible only to them and admins (RLS, migration 0085).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Trash2, Upload, Eye, Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { listDocuments, uploadDocument, getDocumentUrl, deleteDocument, DOC_CATEGORIES, type DocRow, type DocCategory } from "@/lib/documents";
import { DocumentViewerDialog } from "@/components/DocumentViewerDialog";
import { FileField } from "@/components/FileField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function OperatorDocuments() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [viewing, setViewing] = useState<DocRow | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocCategory>("Contract");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDocs(await listDocuments());
    } catch {
      setDocs([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const shared = useMemo(() => (docs ?? []).filter((d) => d.uploaded_by !== user?.id), [docs, user]);
  const mine = useMemo(() => (docs ?? []).filter((d) => d.uploaded_by === user?.id), [docs, user]);

  const submit = async () => {
    if (!user?.id) return;
    if (!title.trim() || !file) {
      toast("Add a title and choose a file.");
      return;
    }
    setBusy(true);
    try {
      await uploadDocument({ file, title, category, audience: "operator", operatorId: user.id, uploaderId: user.id });
      toast("Document uploaded.");
      setTitle(""); setFile(null);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't upload.");
    } finally {
      setBusy(false);
    }
  };

  const download = async (d: DocRow) => {
    try {
      const u = await getDocumentUrl(d.id, true);
      window.open(u, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't download.");
    }
  };

  const remove = async (d: DocRow) => {
    if (!window.confirm(`Delete "${d.title}"?`)) return;
    try {
      await deleteDocument(d.id, d.file_path);
      setDocs((prev) => (prev ? prev.filter((x) => x.id !== d.id) : prev));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't delete.");
    }
  };

  const Row = ({ d, own }: { d: DocRow; own: boolean }) => (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-basalt/12 bg-paper px-4 py-3">
      <FileText className="h-4 w-4 shrink-0 text-basalt/40" />
      <span className="min-w-0 flex-1 truncate font-semibold text-basalt">{d.title}</span>
      <span className="rounded-full bg-chalk px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-basalt/50">{d.category}</span>
      <span className="text-xs text-basalt/40">{fmtDate(d.created_at)}</span>
      <button type="button" onClick={() => setViewing(d)} className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/60 hover:text-apricot"><Eye className="h-3.5 w-3.5" /> View</button>
      <button type="button" onClick={() => download(d)} className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/60 hover:text-apricot"><Download className="h-3.5 w-3.5" /> Download</button>
      {own && <button type="button" onClick={() => remove(d)} className="text-basalt/35 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
    </li>
  );

  return (
    <div>
      <div className="mb-6">
        <p className="eyebrow">Documents</p>
        <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Your documents.</h2>
        <p className="mt-2 max-w-xl text-sm text-basalt/55">Contracts, policies and guides Revamp has shared with you — view them here, or download a copy. You can also upload your own documents (signed agreements, licenses); only you and the Revamp team can see those.</p>
      </div>

      {docs === null ? (
        <div className="grid place-items-center py-10 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="grid gap-8">
          <section>
            <p className="text-sm font-bold uppercase tracking-[0.1em] text-basalt/50">Shared with you</p>
            {shared.length === 0 ? (
              <p className="mt-3 text-sm text-basalt/50">No documents from Revamp yet.</p>
            ) : (
              <ul className="mt-3 grid gap-2">{shared.map((d) => <Row key={d.id} d={d} own={false} />)}</ul>
            )}
          </section>

          <section>
            <p className="text-sm font-bold uppercase tracking-[0.1em] text-basalt/50">Your uploads</p>
            <div className="mt-3 grid gap-3 border border-basalt/12 bg-paper p-4 sm:grid-cols-[1fr_180px_auto] sm:items-end">
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-basalt/60">Title</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Signed operator agreement" className="h-10 rounded-none" />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-basalt/60">Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value as DocCategory)} className="h-10 rounded-none border border-basalt/20 bg-paper px-2 text-sm">
                  {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-basalt/60">File</label>
                <FileField file={file} onChange={setFile} accept=".pdf,.doc,.docx,image/png,image/jpeg,image/webp" />
              </div>
            </div>
            <Button onClick={submit} disabled={busy} className="mt-3 rounded-none bg-apricot font-semibold text-white hover:bg-apricot/90">
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</> : <><Upload className="mr-2 h-4 w-4" /> Upload document</>}
            </Button>
            {mine.length > 0 && <ul className="mt-4 grid gap-2">{mine.map((d) => <Row key={d.id} d={d} own />)}</ul>}
          </section>
        </div>
      )}

      <DocumentViewerDialog doc={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
