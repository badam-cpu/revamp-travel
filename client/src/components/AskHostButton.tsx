/**
 * Pre-booking inquiry — lets a traveler ask the host a question BEFORE booking,
 * to build trust. NO sign-up required: an unregistered visitor gets a silent
 * anonymous session (same pattern as the support widget) so they can message the
 * host and then continue to book with the normal guest checkout flow. They can
 * leave an optional name + email so the host can reply (an anonymous account has
 * no email of its own — the reply is sent there).
 *
 * The question opens (or reuses) a `listing_inquiry` conversation in the unified
 * inbox; the host replies from their own inbox. A host viewing their own listing
 * doesn't see the button, and it's not shown for restaurants.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { MessageCircle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import type { LiveListing } from "@/contexts/ListingsContext";
import { ensureListingInquiryThread, sendInboxMessage, ApiError } from "@/lib/api";
import { toast } from "sonner";

export function AskHostButton({ listing }: { listing: LiveListing }) {
  const { user, profile, signInAnonymously } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  // A host can't inquire on their own listing.
  if (user && listing.operatorId === user.id) return null;

  // A guest is anyone who isn't a "real" (non-anonymous, profiled) traveler.
  const isGuest = !user || !!user.is_anonymous;

  const submit = async () => {
    const text = body.trim();
    if (!text) {
      toast("Type your question first.");
      return;
    }
    if (isGuest && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast("That email doesn't look right — check it, or leave it blank.");
      return;
    }
    setSending(true);
    try {
      // No account? Start a silent anonymous session so the guest can message
      // (and still book as a guest afterwards). Requires anonymous sign-ins
      // enabled in Supabase (same requirement as the support chat).
      if (!user) await signInAnonymously();
      const conversationId = await ensureListingInquiryThread(listing.id, isGuest ? { name: name.trim(), email: email.trim() } : undefined);
      await sendInboxMessage(conversationId, text);
      setOpen(false);
      setBody("");
      if (isGuest) {
        toast.success(email.trim() ? "Sent — the host will reply to your email." : "Sent — the host has your question.");
        // Guests stay on the listing so they can go straight to booking.
      } else {
        toast.success("Sent — the host will reply in your inbox.");
        navigate(profile?.role === "operator" ? "/dashboard?view=messages" : "/account?tab=messages");
      }
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't send your question.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-none border border-basalt/20 px-4 py-2.5 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot"
      >
        <MessageCircle className="h-4 w-4" /> Ask the host a question
      </button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-md rounded-none">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Ask before you book</DialogTitle>
          </DialogHeader>
          <p className="-mt-1 text-sm text-basalt/55">Your question about <span className="font-semibold text-basalt">{listing.title}</span> goes straight to the host — no account or booking needed.</p>
          <Textarea
            autoFocus
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="e.g. Is this available for a group of 6? Can you accommodate a vegetarian menu?"
            className="mt-2 rounded-none text-base"
          />
          {isGuest && (
            <div className="mt-2 grid gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" className="h-10 rounded-none" />
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className="h-10 rounded-none" />
              </div>
              <p className="text-[11px] leading-4 text-basalt/45">Leave your email and the host's reply comes straight to your inbox. No sign-up, and you can book as a guest as usual.</p>
            </div>
          )}
          <DialogFooter className="mt-3">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={submit} disabled={sending} className="rounded-none bg-apricot text-white hover:bg-apricot/90">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send question"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
