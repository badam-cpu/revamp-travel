/**
 * One way in to Aha for guests: the floating Aha panel (SupportWidget) has
 * Chat · Talk · Plan a trip. Buttons elsewhere ("Talk to Aha" on listings, the
 * homepage voice button) ask it to open in a mode with `openAha`; it answers
 * synchronously, so a caller can fall back to its own panel when the Aha panel
 * isn't on the page (it's hidden for operators and admins).
 */
export type AhaMode = "chat" | "talk" | "plan";

type Detail = { mode: AhaMode; handled: boolean };
const EVENT = "aha:open";

/** Opens the Aha panel in `mode`; false when there's no panel to open. */
export function openAha(mode: AhaMode): boolean {
  const detail: Detail = { mode, handled: false };
  window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail }));
  return detail.handled;
}

/** The Aha panel's side: `handler` returns true when it opened. */
export function onAhaOpen(handler: (mode: AhaMode) => boolean): () => void {
  const on = (e: Event) => {
    const d = (e as CustomEvent<Detail>).detail;
    if (d && handler(d.mode)) d.handled = true;
  };
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}
