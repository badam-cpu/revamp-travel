/**
 * Brand-styled file picker — a "Choose file" button + the selected filename,
 * matching the app's inputs (the native <input type="file"> renders differently
 * per browser and clashes with the design). The real input is hidden.
 */
import { useRef } from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

export function FileField({
  file,
  onChange,
  accept,
  className,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  accept?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("flex h-10 items-center gap-2 border border-basalt/20 bg-paper px-2", className)}>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-none bg-chalk px-2.5 py-1.5 text-xs font-semibold text-basalt transition-colors hover:bg-apricot hover:text-white"
      >
        <Paperclip className="h-3.5 w-3.5" /> Choose file
      </button>
      <span className={cn("min-w-0 flex-1 truncate text-sm", file ? "text-basalt" : "text-basalt/40")}>
        {file ? file.name : "No file chosen"}
      </span>
      <input ref={ref} type="file" accept={accept} onChange={(e) => onChange(e.target.files?.[0] ?? null)} className="hidden" />
    </div>
  );
}
