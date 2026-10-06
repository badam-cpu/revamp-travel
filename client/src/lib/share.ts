import { toast } from "sonner";

/**
 * Share the current page. On mobile (and any browser that supports the Web
 * Share API) this opens the OS share sheet — Messages, WhatsApp, Mail, etc. —
 * which is what a phone user expects when they tap "Share". Everywhere else it
 * falls back to copying the link to the clipboard with a toast.
 *
 * `navigator.share` must be called synchronously from the user gesture, so this
 * is not an async wrapper around a pre-check: it tries share first, then falls
 * back. A user who dismisses the native sheet triggers an AbortError — that's a
 * silent no-op, not a failure worth toasting.
 */
export async function shareCurrentPage(title: string): Promise<void> {
  const url = window.location.href;
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };

  if (typeof nav.share === "function") {
    try {
      await nav.share({ title, url });
      return;
    } catch (err) {
      // User cancelled the share sheet — do nothing.
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Any other failure (share not actually available, permission denied):
      // fall through to the clipboard copy below.
    }
  }

  try {
    await navigator.clipboard?.writeText(url);
    toast("Link copied to your clipboard.");
  } catch {
    toast("Couldn't copy the link — you can copy it from the address bar.");
  }
}
