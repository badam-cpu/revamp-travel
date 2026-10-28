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

/**
 * Handing a guest to a real person (Aha AI's `handoff` voice tool). Both open a
 * place where the GUEST sends the message themselves — Aha AI only writes it in:
 *  - "team": the Aha AI panel's Chat (Revamp team replies from /admin), and
 *  - "host": the listing's "Ask the host a question" form.
 * Each returns false when nothing on the page took it.
 */
type HandoffDetail = { text: string; slug?: string; handled: boolean };
const TO_CHAT = "aha:to-chat";
const ASK_HOST = "aha:ask-host";

export function handoffToChat(text: string): boolean {
  const detail: HandoffDetail = { text, handled: false };
  window.dispatchEvent(new CustomEvent<HandoffDetail>(TO_CHAT, { detail }));
  return detail.handled;
}
export function handoffToHost(slug: string, text: string): boolean {
  const detail: HandoffDetail = { text, slug, handled: false };
  window.dispatchEvent(new CustomEvent<HandoffDetail>(ASK_HOST, { detail }));
  return detail.handled;
}
/** Listen for a hand-off; `handler` returns true when it took it. */
export function onHandoff(kind: "chat" | "host", handler: (text: string, slug?: string) => boolean): () => void {
  const name = kind === "chat" ? TO_CHAT : ASK_HOST;
  const on = (e: Event) => {
    const d = (e as CustomEvent<HandoffDetail>).detail;
    if (d && handler(d.text, d.slug)) d.handled = true;
  };
  window.addEventListener(name, on);
  return () => window.removeEventListener(name, on);
}
