/**
 * Pre-booking inquiry — lets a traveler ask the host a question BEFORE booking,
 * to build trust. Opens a small compose dialog that creates (or reuses) a
 * `listing_inquiry` conversation in the unified inbox and posts the first
 * message; the host replies from their own inbox, and both sides continue the
 * thread at /account → Messages and /dashboard → Messages.
 *
 * Signed out → routes to sign in and back. A host viewing their own listing
 * doesn't see the button (can't message themselves). Not shown for restaurants
 * (curated, no bookable host account).
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { MessageCircle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import type { LiveListing } from "@/contexts/ListingsContext";
import { ensureListingInquiryThread, sendInboxMessage, ApiError } from "@/lib/api";
import { toast } from "sonner";

export function AskHostButton({ listing }: { listing: LiveListing }) {
  const { user, profile } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  // A host can't inquire on their own listing.
  if (user && listing.operatorId === user.id) return null;

  const start = () => {
    if (!user) {
      navigate(`/login?redirect=/listing/${listing.slug}`);
      return;
    }
    setOpen(true);
  };

  const submit = async () => {
    const text = body.trim();
    if (!text) {
      toast("Type your question first.");
      return;
    }
    setSending(true);
    try {
      const conversationId = await ensureListingInquiryThread(listing.id);
      await sendInboxMessage(conversationId, text);
      toast.success("Sent — the host will reply in your inbox.");
      setOpen(false);
      setBody("");
      // Operators land in the dashboard inbox; travelers in their account inbox.
      navigate(profile?.role === "operator" ? "/dashboard?view=messages" : "/account?tab=messages");
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
        onClick={start}
        className="inline-flex w-full items-center justify-center gap-2 rounded-none border border-basalt/20 px-4 py-2.5 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot"
      >
        <MessageCircle className="h-4 w-4" /> Ask the host a question
      </button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-md rounded-none">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Ask before you book</DialogTitle>
          </DialogHeader>
          <p className="-mt-1 text-sm text-basalt/55">Your question about <span className="font-semibold text-basalt">{listing.title}</span> goes straight to the host. You'll get their reply in your inbox — no booking needed.</p>
          <Textarea
            autoFocus
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="e.g. Is the experience available for a group of 6? Can you accommodate a vegetarian menu?"
            className="mt-2 rounded-none text-base"
          />
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
