/**
 * Site-wide announcement, admin-controlled via site_settings (see
 * SiteSettingsContext / the /admin editor). Renders as a small dismissible
 * popup card in the bottom-left (clear of the bottom-right support bubble),
 * only when the admin has enabled it and set a message. Dismissed per browser
 * session, keyed by the message text so a new announcement re-appears even if
 * the last one was dismissed.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Megaphone, X } from "lucide-react";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";

function dismissKey(message: string) {
  return `revamp:announceDismissed:${message}`;
}

export function AnnouncementBanner() {
  const { settings } = useSiteSettings();
  const { announcementEnabled, announcementMessage, announcementHref } = settings;
  const [dismissed, setDismissed] = useState(true);
  const [shown, setShown] = useState(false); // drives the slide-in

  useEffect(() => {
    if (!announcementEnabled || !announcementMessage.trim()) {
      setDismissed(true);
      return;
    }
    let already = false;
    try {
      already = sessionStorage.getItem(dismissKey(announcementMessage)) === "1";
    } catch {
      already = false;
    }
    setDismissed(already);
  }, [announcementEnabled, announcementMessage]);

  // Trigger the entrance transition once it's on screen.
  useEffect(() => {
    if (dismissed) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), 60);
    return () => clearTimeout(t);
  }, [dismissed]);

  if (!announcementEnabled || !announcementMessage.trim() || dismissed) return null;

  const message = announcementMessage.trim();
  const href = announcementHref.trim();
  const isExternal = /^https?:\/\//i.test(href);

  const dismiss = () => {
    try {
      sessionStorage.setItem(dismissKey(message), "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      /* Bottom-left. The AI bubble is bottom-right at bottom-20 (top ~136px)
         below lg, so on phones — where this card is near full-width — it sits
         above the bubble (bottom-40); from sm up the card is narrow and left,
         cleanly clear of the right-side bubble at bottom-4. */
      className={`fixed bottom-40 left-4 z-40 w-[calc(100%-2rem)] max-w-[340px] transition-all duration-300 ease-out motion-reduce:transition-none sm:bottom-4 ${
        shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
    >
      <div className="brand-notch relative flex gap-3 border border-basalt/12 bg-paper p-4 pr-9 shadow-[0_18px_50px_rgba(35,35,33,0.18)]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-apricot/12 text-apricot">
          <Megaphone className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-sm font-semibold leading-5 text-basalt">{message}</p>
          {href &&
            (isExternal ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-semibold text-apricot underline underline-offset-2 hover:text-apricot/80">
                Learn more
              </a>
            ) : (
              <Link href={href} onClick={dismiss} className="mt-1 inline-block text-sm font-semibold text-apricot underline underline-offset-2 hover:text-apricot/80">
                Learn more
              </Link>
            ))}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss announcement"
          className="absolute right-2.5 top-2.5 grid h-6 w-6 place-items-center rounded-full text-basalt/45 transition-colors hover:bg-chalk hover:text-basalt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
