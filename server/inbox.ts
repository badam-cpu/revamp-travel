/**
 * Mirror automated confirmations into the unified inbox (migration 0038) as a
 * 'system' message (migration 0064) on the booking's conversation, so travelers,
 * operators, and admins see every confirmation in one place — not just email.
 *
 * All writes are service-role (RLS grants no client insert here); reads are the
 * existing participant/admin message policies, which already cover system rows.
 * Best-effort: never throws, so a messaging hiccup can't break a confirmation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ensure the booking's conversation (+ participants) exists and append a system
 * message. Fetches the booking/listing when operatorId/travelerId aren't passed.
 */
export async function postSystemMessage(
  admin: SupabaseClient,
  opts: { bookingId: string; listingId?: string; operatorId?: string; travelerId?: string | null; body: string },
): Promise<void> {
  try {
    let { listingId, operatorId, travelerId } = opts;

    if (!listingId || travelerId === undefined) {
      const { data: b } = await admin.from("bookings").select("listing_id, traveler_id").eq("id", opts.bookingId).maybeSingle();
      if (!b) return;
      listingId = listingId ?? (b.listing_id as string);
      travelerId = travelerId === undefined ? (b.traveler_id as string | null) : travelerId;
    }
    if (!operatorId && listingId) {
      const { data: l } = await admin.from("listings").select("operator_id").eq("id", listingId).maybeSingle();
      operatorId = l?.operator_id as string | undefined;
    }

    // Find or create the booking conversation.
    let conversationId: string | undefined;
    const { data: existing } = await admin
      .from("conversations")
      .select("id")
      .eq("booking_id", opts.bookingId)
      .eq("kind", "booking")
      .maybeSingle();
    if (existing) {
      conversationId = existing.id as string;
    } else {
      const { data: created, error: cErr } = await admin
        .from("conversations")
        .insert({ kind: "booking", booking_id: opts.bookingId, listing_id: listingId ?? null })
        .select("id")
        .single();
      if (cErr || !created) return;
      conversationId = created.id as string;
      // Participants: operator always; traveler only when the booking has an account
      // (guests have no profile row, so they can't be a participant — the operator
      // and admins still see the system message).
      const participants: { conversation_id: string; user_id: string; role: string }[] = [];
      if (operatorId) participants.push({ conversation_id: conversationId, user_id: operatorId, role: "operator" });
      if (travelerId) participants.push({ conversation_id: conversationId, user_id: travelerId, role: "traveler" });
      if (participants.length) await admin.from("conversation_participants").insert(participants);
    }
    if (!conversationId) return;

    await admin.from("messages").insert({
      conversation_id: conversationId,
      sender_id: null,
      sender_role: "system",
      body: opts.body,
    });
    await admin.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);
  } catch (err) {
    console.warn("[inbox] postSystemMessage failed", err);
  }
}
