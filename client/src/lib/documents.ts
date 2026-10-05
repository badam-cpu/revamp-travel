/**
 * Documents (contracts, policies, guides, operator uploads). Metadata lives in
 * the `documents` table (RLS-scoped — an operator sees all-operator docs + their
 * own); the files live in the private `operator-documents` Storage bucket.
 * Reads of the actual file go through GET /api/document-url, which mints a
 * short-lived signed URL after checking access (see server/routes.ts). Migration
 * 0085.
 */
import { supabase } from "@/lib/supabase";

const BUCKET = "operator-documents";
export const DOC_CATEGORIES = ["Contract", "Policy", "Guide", "Other"] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

export interface DocRow {
  id: string;
  title: string;
  category: string;
  file_path: string;
  file_name: string | null;
  file_type: string | null;
  size_bytes: number | null;
  audience: "all_operators" | "operator";
  operator_id: string | null;
  uploaded_by: string;
  created_at: string;
}

/** RLS returns only the docs the caller may see. */
export async function listDocuments(): Promise<DocRow[]> {
  const { data, error } = await supabase.from("documents").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DocRow[];
}

export async function uploadDocument(opts: {
  file: File;
  title: string;
  category: DocCategory;
  audience: "all_operators" | "operator";
  operatorId: string | null; // target operator for an admin-targeted doc; null for all_operators
  uploaderId: string;
}): Promise<void> {
  const ext = (opts.file.name.split(".").pop() || "bin").toLowerCase();
  const owner = opts.audience === "all_operators" ? "shared" : opts.operatorId ?? opts.uploaderId;
  const path = `${owner}/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from(BUCKET).upload(path, opts.file, { contentType: opts.file.type || undefined, upsert: false });
  if (up.error) throw new Error(up.error.message);
  const { error } = await supabase.from("documents").insert({
    title: opts.title.trim(),
    category: opts.category,
    file_path: path,
    file_name: opts.file.name,
    file_type: opts.file.type || null,
    size_bytes: opts.file.size,
    audience: opts.audience,
    operator_id: opts.audience === "all_operators" ? null : opts.operatorId ?? opts.uploaderId,
    uploaded_by: opts.uploaderId,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new Error(error.message);
  }
}

/** A short-lived signed URL for viewing (inline) or downloading a document. */
export async function getDocumentUrl(id: string, download = false): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in.");
  const res = await fetch(`/api/document-url?id=${encodeURIComponent(id)}${download ? "&download=1" : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || "Couldn't open that document.");
  }
  const json = (await res.json()) as { url: string };
  return json.url;
}

export async function deleteDocument(id: string, filePath: string): Promise<void> {
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await supabase.storage.from(BUCKET).remove([filePath]).catch(() => {});
}
