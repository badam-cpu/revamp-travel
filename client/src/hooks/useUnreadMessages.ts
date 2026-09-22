/**
 * Total unread inbox messages for the signed-in user, for the header badge.
 * Polls every 45s and refreshes on window focus + the `revamp:messages-read`
 * event (dispatched by markConversationRead) so the badge clears promptly after
 * reading. Returns 0 when signed out. No realtime yet (Phase 3).
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getUnreadTotal } from "@/lib/messaging";

export function useUnreadMessages(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setCount(0);
      return;
    }
    let active = true;
    const load = () =>
      getUnreadTotal(user.id)
        .then((n) => {
          if (active) setCount(n);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 45000);
    window.addEventListener("focus", load);
    window.addEventListener("revamp:messages-read", load);
    return () => {
      active = false;
      clearInterval(t);
      window.removeEventListener("focus", load);
      window.removeEventListener("revamp:messages-read", load);
    };
  }, [user]);

  return count;
}
