/**
 * Unified inbox — client reads (Supabase, RLS-scoped) + types. Writes (opening a
 * booking thread, sending a message) go through the server for guardrails and
 * rate limiting — see ensureBookingThread / sendInboxMessage in lib/api.ts.
 *
 * RLS (migration 0038) returns only the conversations the signed-in user is a
 * participant of — or, for an admin, EVERY conversation. So the same reads power
 * both a traveler/operator inbox and the admin oversight view; the caller just
 * passes their own id (admins won't be participants, so unread stays 0 and the
 * `parties` list is used to show who's talking).
 */
import { supabase } from "@/lib/supabase";

export type SenderRole = "traveler" | "operator" | "support";

export interface InboxMessage {
  id: string;
  conversationId: string;
  senderId: string | null;
  senderRole: SenderRole;
  body: string;
  flagged: boolean;
  redacted: boolean;
  createdAt: string;
}

export interface InboxConversation {
  id: string;
  kind: "booking" | "listing_inquiry" | "support";
  listingId: string | null;
  bookingId: string | null;
  lastMessageAt: string;
  listing: { title: string; slug: string | null; image: string | null } | null;
  /** Who the current user is talking to (first other participant). */
  counterpart: { name: string; logo: string | null } | null;
  /** All participants + role — used by the admin view to show both sides. */
  parties: { name: string; role: string }[];
  preview: string;
  unread: number;
  flaggedCount: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapMsg(m: any): InboxMessage {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id ?? null,
    senderRole: m.sender_role,
    body: m.redacted ? "(message removed by Revamp)" : m.body,
    flagged: !!m.flagged,
    redacted: !!m.redacted,
    createdAt: m.created_at,
  };
}

/** Every conversation visible to `userId` (their own, or all for an admin). */
export async function listConversations(userId: string): Promise<InboxConversation[]> {
  const { data: convos, error } = await supabase
    .from("conversations")
    .select(
      "id, kind, listing_id, booking_id, last_message_at, conversation_participants(user_id, role, last_read_at), listings(title, slug, image)",
    )
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (error || !convos) return [];
  const ids = convos.map((c: any) => c.id);
  if (!ids.length) return [];

  // Participant display names (business name preferred) + logos, in one query.
  const userIds = Array.from(new Set(convos.flatMap((c: any) => (c.conversation_participants ?? []).map((p: any) => p.user_id))));
  const profMap = new Map<string, { name: string; logo: string | null }>();
  if (userIds.length) {
    // select("*") stays resilient if the logo_url column (0037) isn't added yet.
    const { data: profs } = await supabase.from("profiles").select("*").in("id", userIds);
    for (const p of profs ?? []) profMap.set(p.id, { name: p.business_name || p.display_name || "Someone", logo: (p as { logo_url?: string | null }).logo_url ?? null });
  }

  // Latest message (preview) + unread + flagged counts, in one query.
  const { data: msgs } = await supabase
    .from("messages")
    .select("conversation_id, body, created_at, sender_id, redacted, flagged")
    .in("conversation_id", ids)
    .order("created_at", { ascending: false })
    .limit(1000);
  const latest = new Map<string, any>();
  const byConvo = new Map<string, any[]>();
  for (const m of msgs ?? []) {
    if (!latest.has(m.conversation_id)) latest.set(m.conversation_id, m);
    const arr = byConvo.get(m.conversation_id) ?? [];
    arr.push(m);
    byConvo.set(m.conversation_id, arr);
  }

  return convos.map((c: any) => {
    const parts = c.conversation_participants ?? [];
    const mine = parts.find((p: any) => p.user_id === userId);
    const others = parts.filter((p: any) => p.user_id !== userId);
    const counterpartId = others[0]?.user_id;
    const cp = counterpartId ? profMap.get(counterpartId) ?? null : null;
    const lastRead = mine?.last_read_at ? Date.parse(mine.last_read_at) : 0;
    const convoMsgs = byConvo.get(c.id) ?? [];
    const unread = mine ? convoMsgs.filter((m: any) => m.sender_id !== userId && Date.parse(m.created_at) > lastRead).length : 0;
    const flaggedCount = convoMsgs.filter((m: any) => m.flagged).length;
    const lm = latest.get(c.id);
    const preview = lm ? (lm.redacted ? "(message removed)" : lm.body) : "No messages yet";
    return {
      id: c.id,
      kind: c.kind,
      listingId: c.listing_id,
      bookingId: c.booking_id,
      lastMessageAt: c.last_message_at,
      listing: c.listings ? { title: c.listings.title, slug: c.listings.slug ?? null, image: c.listings.image ?? null } : null,
      counterpart: cp,
      parties: parts.map((p: any) => ({ name: profMap.get(p.user_id)?.name ?? "Someone", role: p.role })),
      preview,
      unread,
      flaggedCount,
    };
  });
}

/** All messages in a conversation, oldest first. */
export async function getMessages(conversationId: string): Promise<InboxMessage[]> {
  const { data } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, sender_role, body, flagged, redacted, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);
  return (data ?? []).map(mapMsg);
}

/** Mark a conversation read up to now (updates the caller's own participant row). */
export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  await supabase
    .from("conversation_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
