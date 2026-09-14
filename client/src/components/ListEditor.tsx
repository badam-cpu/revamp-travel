/**
 * Small reusable add/remove list editor for free-text entries that read
 * better as full rows than as short chips — an experience's itinerary
 * steps, what's-not-included exceptions, what-to-bring items. Modeled on
 * AmenityPicker's own "type + Enter or click Add" custom-entry pattern
 * (client/src/components/AmenityPicker.tsx) so the interaction feels
 * consistent across the dashboard, but this one has no curated catalog —
 * every value here is operator-authored text, kept in the order it was
 * added (drag-to-reorder is intentionally out of scope; reordering by
 * remove-and-re-add is enough for this size of list).
 *
 * Controlled, not uncontrolled — unlike AmenityPicker/ListingFormDialog's
 * other fields, ExperienceOnboarding.tsx needs to read every field on every
 * keystroke (to drive the review step and the "next" button's validity), so
 * this takes `values`/`onChange` rather than exposing a ref handle.
 */
import { useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function ListEditor({
  label,
  placeholder,
  values,
  onChange,
  minRecommended,
  numbered = false,
  helpText,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** A soft, Airbnb-style nudge ("5+ steps make a stronger listing") — never blocks moving on. */
  minRecommended?: number;
  /** Show 1/2/3 badges instead of a plain remove-only row — used for itinerary steps, where order matters. */
  numbered?: boolean;
  helpText?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...values, text]);
    setDraft("");
  };

  const remove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  };

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {helpText && <p className="-mt-1 text-xs text-basalt/45">{helpText}</p>}

      {values.length > 0 && (
        <div className="grid gap-2">
          {values.map((value, i) => (
            <div key={`${i}-${value}`} className="flex items-start gap-3 border border-basalt/12 bg-chalk px-3 py-2.5 text-sm text-basalt/80">
              {numbered && (
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-apricot/15 text-[11px] font-bold text-apricot">
                  {i + 1}
                </span>
              )}
              <span className="flex-1 leading-5">{value}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove "${value}"`}
                className="mt-0.5 shrink-0 text-basalt/35 hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-9 rounded-none text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={!draft.trim()}
          className="h-9 shrink-0 rounded-none border-basalt/15 text-xs"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {typeof minRecommended === "number" && values.length < minRecommended && (
        <p className="text-xs text-tuff">{minRecommended}+ recommended — you have {values.length} so far.</p>
      )}
    </div>
  );
}
