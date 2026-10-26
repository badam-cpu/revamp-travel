import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Pages load on demand (App.tsx). After a deploy, a tab opened earlier can ask
// for a chunk that no longer exists: reload once to pick up the new version
// (guarded so a genuinely broken network can't loop).
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem("revamp.chunkReload") || 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem("revamp.chunkReload", String(Date.now()));
  } catch {
    /* storage blocked — still try one reload */
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);

// Register the PWA service worker (installable app + offline shell). Dev servers
// run on http://localhost which is a secure context, but we only register in
// production builds so HMR/dev isn't affected by caching.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* registration is best-effort — the app works without it */
    });
  });
}
