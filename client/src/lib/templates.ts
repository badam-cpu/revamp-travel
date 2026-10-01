/**
 * Operator message templates (reusable canned replies) + auto-reply settings
 * (migration 0082). Templates are operator-owned, managed directly under RLS.
 * Auto-reply enabled/message live on the operator's own profile row (self-
 * editable under the profiles update policy). Used by the Settings panel and the
 * inbox composer's "Templates" insert.
 */
import { supabase } from "@/lib/supabase";

export interface MessageTemplate {
  id: string;
  title: string;
  body: string;
}

export async function listTemplates(operatorId: string): Promise<MessageTemplate[]> {
  const { data } = await supabase
    .from("message_templates")
    .select("id, title, body")
    .eq("operator_id", operatorId)
    .order("created_at", { ascending: true });
  return (data as MessageTemplate[]) ?? [];
}

export async function createTemplate(operatorId: string, title: string, body: string): Promise<void> {
  const { error } = await supabase.from("message_templates").insert({ operator_id: operatorId, title: title.trim(), body: body.trim() });
  if (error) throw new Error(error.message);
}

export async function updateTemplate(id: string, title: string, body: string): Promise<void> {
  const { error } = await supabase.from("message_templates").update({ title: title.trim(), body: body.trim(), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("message_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export interface AutoReplySettings {
  enabled: boolean;
  message: string;
}

export async function getAutoReply(operatorId: string): Promise<AutoReplySettings> {
  const { data } = await supabase.from("profiles").select("auto_reply_enabled, auto_reply_message").eq("id", operatorId).maybeSingle();
  return { enabled: !!data?.auto_reply_enabled, message: (data?.auto_reply_message as string) ?? "" };
}

export async function setAutoReply(operatorId: string, s: AutoReplySettings): Promise<void> {
  const { error } = await supabase.from("profiles").update({ auto_reply_enabled: s.enabled, auto_reply_message: s.message.trim() || null }).eq("id", operatorId);
  if (error) throw new Error(error.message);
}
