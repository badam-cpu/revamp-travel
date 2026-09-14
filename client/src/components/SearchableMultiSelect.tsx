/**
 * Searchable multi-select for operator listing fields whose values come from a
 * long-ish curated list — "Not included," "What to bring," "Not suitable for"
 * (see Dashboard.tsx). Modeled on the GetYourGuide-style pattern: a search box
 * filtering a checkable list, with selected values shown as removable chips,
 * plus an "add your own" escape hatch so the curated list is never a hard
 * ceiling.
 *
 * Uncontrolled by design, same as AmenityPicker/PhotoUploader: it owns its
 * selection (seeded from `defaultValue`) and exposes the ordered values via
 * `ref.getValue()`, read once at submit time. Curated options are passed in by
 * the caller so the same component serves every field; any existing value not
 * in the curated list (legacy or custom) still shows as a selected chip and is
 * never dropped.
 */
import { forwardRef, useImperativeHandle, useMemo, useState, type KeyboardEvent } from "react";
import { Search, X, Plus, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type SearchableMultiSelectHandle = { getValue: () => string[] };

export const SearchableMultiSelect = forwardRef<
  SearchableMultiSelectHandle,
  { options: string[]; defaultValue?: string[]; placeholder?: string; allowCustom?: boolean }
>(function SearchableMultiSelect({ options, defaultValue = [], placeholder = "Search for items", allowCustom = true }, ref) {
  const [selected, setSelected] = useState<string[]>(defaultValue.filter(Boolean));
  const [query, setQuery] = useState("");

  useImperativeHandle(ref, () => ({ getValue: () => selected }), [selected]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => options.filter((o) => o.toLowerCase().includes(q)), [options, q]);
  // An exact (case-insensitive) match already in the curated list or selection?
  const hasExact = [...options, ...selected].some((o) => o.toLowerCase() === q);

  const toggle = (item: string) =>
    setSelected((prev) => (prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item]));

  const remove = (item: string) => setSelected((prev) => prev.filter((v) => v !== item));

  const addCustom = () => {
    const value = query.trim();
    if (!value) return;
    setSelected((prev) => (prev.some((v) => v.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value]));
    setQuery("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (allowCustom) addCustom();
    }
  };

  return (
    <div className="grid gap-2">
      {/* Search box */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-basalt/40" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="h-11 rounded-none pl-9 text-sm"
        />
      </div>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((item) => (
            <Badge key={item} variant="outline" className="gap-1 rounded-none border-apricot/40 bg-apricot/5 px-2 py-1 text-basalt">
              {item}
              <button type="button" onClick={() => remove(item)} aria-label={`Remove ${item}`} className="text-basalt/40 hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Filtered curated list */}
      <div className="max-h-56 overflow-y-auto border border-basalt/15 bg-paper">
        {allowCustom && q && !hasExact && (
          <button
            type="button"
            onClick={addCustom}
            className="flex w-full items-center gap-2 border-b border-basalt/10 px-3 py-2.5 text-left text-sm text-apricot hover:bg-apricot/5"
          >
            <Plus className="h-4 w-4" /> Add “{query.trim()}”
          </button>
        )}
        {filtered.length === 0 && !(allowCustom && q) ? (
          <p className="px-3 py-3 text-xs text-basalt/45">No matches.</p>
        ) : (
          filtered.map((item) => {
            const isSelected = selected.includes(item);
            return (
              <button
                key={item}
                type="button"
                onClick={() => toggle(item)}
                className="flex w-full items-center gap-3 border-b border-basalt/5 px-3 py-2.5 text-left text-sm text-basalt last:border-b-0 hover:bg-chalk"
              >
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border",
                    isSelected ? "border-apricot bg-apricot text-white" : "border-basalt/30",
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </span>
                {item}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
});
