/**
 * Site-wide announcement bar, admin-controlled via site_settings (see
 * SiteSettingsContext / the /admin editor). Renders only when the admin has
 * enabled it and set a message. Dismissible per browser session, keyed by the
 * message text so a new announcement re-appears even if the last was dismissed.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { X } from "lucide-react";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";

function dismissKey(message: string) {
  return `revamp:announceDismissed:${message}`;
}

export function AnnouncementBanner() {
  const { settings } = useSiteSettings();
  const { announcementEnabled, announcementMessage, announcementHref } = settings;
  const [dismissed, setDismissed] = useState(true);

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
    <div className="relative bg-apricot px-10 py-2.5 text-center text-sm font-semibold text-white">
      <span>
        {message}
        {href &&
          (isExternal ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="ml-2 underline underline-offset-2">
              Learn more
            </a>
          ) : (
            <Link href={href} className="ml-2 underline underline-offset-2">
              Learn more
            </Link>
          ))}
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/80 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
