/**
 * Inline document viewer. Opens a dialog and renders the file without a download:
 * PDFs and images embed directly (via a short-lived signed URL from
 * getDocumentUrl); other types show a "download to open" fallback. A Download
 * button is always available.
 */
import { useEffect, useState } from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getDocumentUrl, type DocRow } from "@/lib/documents";
import { toast } from "sonner";

export function DocumentViewerDialog({ doc, onClose }: { doc: DocRow | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(null);
    if (!doc) return;
    setLoading(true);
    getDocumentUrl(doc.id)
      .then((u) => { if (active) setUrl(u); })
      .catch((e) => { if (active) toast.error(e instanceof Error ? e.message : "Couldn't open that document."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [doc]);

  const isPdf = (doc?.file_type || "").includes("pdf") || (doc?.file_name || "").toLowerCase().endsWith(".pdf");
  const isImage = (doc?.file_type || "").startsWith("image/");

  const download = async () => {
    if (!doc) return;
    try {
      const u = await getDocumentUrl(doc.id, true);
      window.open(u, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't download.");
    }
  };

  return (
    <Dialog open={!!doc} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl gap-0 rounded-none p-0">
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b border-basalt/10 px-5 py-3">
          <DialogTitle className="truncate text-base">{doc?.title || "Document"}</DialogTitle>
          <button type="button" onClick={download} className="mr-6 inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-apricot hover:underline">
            <Download className="h-4 w-4" /> Download
          </button>
        </DialogHeader>
        <div className="h-[75vh] bg-chalk/40">
          {loading || !url ? (
            <div className="grid h-full place-items-center text-basalt/50"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : isPdf ? (
            <iframe src={url} title={doc?.title || "Document"} className="h-full w-full border-0" />
          ) : isImage ? (
            <div className="grid h-full place-items-center overflow-auto p-4"><img src={url} alt={doc?.title || "Document"} className="max-h-full max-w-full object-contain" /></div>
          ) : (
            <div className="grid h-full place-items-center p-6 text-center">
              <div>
                <p className="text-sm text-basalt/60">This file type can't be previewed here.</p>
                <button type="button" onClick={download} className="mt-4 inline-flex items-center gap-2 rounded-none bg-apricot px-4 py-2.5 text-sm font-semibold text-white hover:bg-apricot/90">
                  <ExternalLink className="h-4 w-4" /> Open / download
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
