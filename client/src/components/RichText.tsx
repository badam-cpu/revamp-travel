/**
 * Renders an operator description with line breaks kept and `**words**` shown
 * bold (shared/richText.ts). React escapes every run, so this is as safe as the
 * plain `{text}` it replaces.
 */
import { parseBold } from "@shared/richText";

export function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={className}>
      {parseBold(text).map((seg, i) =>
        seg.bold ? <strong key={i} className="font-semibold text-basalt">{seg.text}</strong> : <span key={i}>{seg.text}</span>,
      )}
    </p>
  );
}
