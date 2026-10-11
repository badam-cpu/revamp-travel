/**
 * "B" button for a description textarea: wraps the selected words in `**…**`
 * (or unwraps them if they're already bold), also on Ctrl/⌘+B. Works for both
 * uncontrolled and controlled textareas — the value goes through the native
 * setter + a bubbling "input" event, which React and CharCount both pick up.
 */
import { useEffect } from "react";
import { Bold } from "lucide-react";
import { cn } from "@/lib/utils";

function setNativeValue(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function toggleBold(el: HTMLTextAreaElement) {
  const { value, selectionStart: s, selectionEnd: e } = el;
  let start = s;
  let end = e;
  // Keep surrounding spaces outside the markers ("**word** ", not "**word **").
  while (start < end && /\s/.test(value[start])) start++;
  while (end > start && /\s/.test(value[end - 1])) end--;
  const sel = value.slice(start, end);

  let next: string;
  let selFrom: number;
  let selTo: number;
  if (value.slice(start - 2, start) === "**" && value.slice(end, end + 2) === "**") {
    // Already bold → unwrap.
    next = value.slice(0, start - 2) + sel + value.slice(end + 2);
    selFrom = start - 2;
    selTo = end - 2;
  } else if (sel.startsWith("**") && sel.endsWith("**") && sel.length > 4) {
    next = value.slice(0, start) + sel.slice(2, -2) + value.slice(end);
    selFrom = start;
    selTo = end - 4;
  } else {
    const inner = sel || "bold text";
    if (el.maxLength > 0 && value.length - sel.length + inner.length + 4 > el.maxLength) return;
    next = value.slice(0, start) + `**${inner}**` + value.slice(end);
    selFrom = start + 2;
    selTo = start + 2 + inner.length;
  }
  setNativeValue(el, next);
  el.focus();
  el.setSelectionRange(selFrom, selTo);
}

export function BoldButton({ forId, className }: { forId: string; className?: string }) {
  useEffect(() => {
    const el = document.getElementById(forId) as HTMLTextAreaElement | null;
    if (!el) return;
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === "b") {
        ev.preventDefault();
        toggleBold(el);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [forId]);

  return (
    <button
      type="button"
      title="Bold — select words, then click (or Ctrl/⌘+B)"
      aria-label="Make selected text bold"
      // Keep the textarea's selection: don't let the button take focus on press.
      onMouseDown={(ev) => ev.preventDefault()}
      onClick={() => {
        const el = document.getElementById(forId) as HTMLTextAreaElement | null;
        if (el) toggleBold(el);
      }}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-none border border-basalt/15 bg-paper text-basalt/70 hover:border-apricot hover:text-apricot focus-visible:outline-2 focus-visible:outline-apricot",
        className,
      )}
    >
      <Bold className="h-4 w-4" strokeWidth={2.5} />
    </button>
  );
}
