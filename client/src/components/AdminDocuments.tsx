/**
 * Admin → Documents. Upload a document for ALL operators (contracts, policies,
 * guides) or target a specific operator; list + delete everything. Operators see
 * their matching docs in Dashboard → Documents. Files live in the private
 * operator-documents bucket; access is server-checked (migration 0085).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Trash2, Upload, Eye, Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { listDocuments, uploadDocument, getDocumentUrl, deleteDocument, DOC_CATEGORIES, type DocRow, type DocCategory } from "@/lib/documents";
import { DocumentViewerDialog } from "@/components/DocumentViewerDialog";
import { FileField } from "@/components/FileField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface OperatorOpt { id: string; name: string }

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function AdminDocuments() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [operators, setOperators] = useState<OperatorOpt[]>([]);
  const [viewing, setViewing] = useState<DocRow | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocCategory>("Contract");
  const [audience, setAudience] = useState<"all_operators" | "operator">("all_operators");
  const [operatorId, setOperatorId] = useState("");
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

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, display_name, business_name, role")
      .eq("role", "operator")
      .then(({ data }) => {
        setOperators((data ?? []).map((p) => ({ id: p.id as string, name: (p.business_name as string) || (p.display_name as string) || "Operator" })).sort((a, b) => a.name.localeCompare(b.name)));
      });
  }, []);

  const opName = useMemo(() => {
    const m = new Map(operators.map((o) => [o.id, o.name]));
    return (id: string | null) => (id ? m.get(id) || "an operator" : "");
  }, [operators]);

  const submit = async () => {
    if (!user?.id) return;
    if (!title.trim() || !file) { toast("Add a title and choose a file."); return; }
    if (audience === "operator" && !operatorId) { toast("Pick the operator this is for."); return; }
    setBusy(true);
    try {
      await uploadDocument({ file, title, category, audience, operatorId: audience === "operator" ? operatorId : null, uploaderId: user.id });
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
    try { window.open(await getDocumentUrl(d.id, true), "_blank", "noopener,noreferrer"); }
    catch (e) { toast(e instanceof Error ? e.message : "Couldn't download."); }
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

  return (
    <div>
      <div className="mb-6">
        <p className="eyebrow">Documents</p>
        <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Operator documents.</h2>
        <p className="mt-2 max-w-xl text-sm text-basalt/55">Share contracts, policies and guides with all operators, or send one to a specific operator. They appear in that operator's Dashboard → Documents, viewable online.</p>
      </div>

      <div className="grid gap-3 border border-basalt/12 bg-paper p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><label className="text-xs font-semibold text-basalt/60">Title</label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Operator agreement 2026" className="h-10 rounded-none" /></div>
          <div className="grid gap-1.5"><label className="text-xs font-semibold text-basalt/60">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as DocCategory)} className="h-10 rounded-none border border-basalt/20 bg-paper px-2 text-sm">
              {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5"><label className="text-xs font-semibold text-basalt/60">Who can see it</label>
            <select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} className="h-10 rounded-none border border-basalt/20 bg-paper px-2 text-sm">
              <option value="all_operators">All operators</option>
              <option value="operator">A specific operator</option>
            </select>
          </div>
          {audience === "operator" && (
            <div className="grid gap-1.5"><label className="text-xs font-semibold text-basalt/60">Operator</label>
              <select value={operatorId} onChange={(e) => setOperatorId(e.target.value)} className="h-10 rounded-none border border-basalt/20 bg-paper px-2 text-sm">
                <option value="">Choose an operator…</option>
                {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2"><label className="text-xs font-semibold text-basalt/60">File (PDF, Word, or image · up to 25 MB)</label>
            <FileField file={file} onChange={setFile} accept=".pdf,.doc,.docx,image/png,image/jpeg,image/webp" />
          </div>
        </div>
        <div className="border-t border-basalt/10 pt-4">
          <Button onClick={submit} disabled={busy} className="rounded-none bg-apricot font-semibold text-white hover:bg-apricot/90">
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</> : <><Upload className="mr-2 h-4 w-4" /> Upload</>}
          </Button>
        </div>
      </div>

      <div className="mt-8">
        <p className="text-sm font-bold uppercase tracking-[0.1em] text-basalt/50">All documents</p>
        {docs === null ? (
          <div className="grid place-items-center py-10 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : docs.length === 0 ? (
          <p className="mt-3 text-sm text-basalt/50">No documents yet.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-basalt/12 bg-paper px-4 py-3">
                <FileText className="h-4 w-4 shrink-0 text-basalt/40" />
                <span className="min-w-0 flex-1 truncate font-semibold text-basalt">{d.title}</span>
                <span className="rounded-full bg-chalk px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-basalt/50">{d.category}</span>
                <span className="text-xs text-basalt/45">{d.audience === "all_operators" ? "All operators" : `→ ${opName(d.operator_id)}`}</span>
                <span className="text-xs text-basalt/40">{fmtDate(d.created_at)}</span>
                <button type="button" onClick={() => setViewing(d)} className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/60 hover:text-apricot"><Eye className="h-3.5 w-3.5" /> View</button>
                <button type="button" onClick={() => download(d)} className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/60 hover:text-apricot"><Download className="h-3.5 w-3.5" /> Download</button>
                <button type="button" onClick={() => remove(d)} className="text-basalt/35 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DocumentViewerDialog doc={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
