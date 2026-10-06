import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

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
