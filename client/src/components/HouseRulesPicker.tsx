/**
 * Simple house-rules checklist for the operator stay form. Same uncontrolled
 * ref pattern as AmenityPicker (owns its own selection, exposes it via
 * ref.getValue(), read once at submit). Options come from the shared catalog in
 * client/src/lib/houseRules.ts; selection is stored on the listing's
 * `houseRules` text[] (migration 0021). Any stored value not in the catalog
 * (legacy/custom) is preserved as a checked row so editing never drops it.
 */
import { forwardRef, useImperativeHandle, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { HOUSE_RULES, houseRuleIcon } from "@/lib/houseRules";

export type HouseRulesPickerHandle = { getValue: () => string[] };

export const HouseRulesPicker = forwardRef<HouseRulesPickerHandle, { defaultValue: string[] }>(
  function HouseRulesPicker({ defaultValue }, ref) {
    const [value, setValue] = useState<string[]>(defaultValue);
    useImperativeHandle(ref, () => ({ getValue: () => value }), [value]);

    const catalogLabels = new Set(HOUSE_RULES.map((r) => r.label));
    const extras = value.filter((v) => !catalogLabels.has(v));
    const rows = [...HOUSE_RULES, ...extras.map((label) => ({ label, icon: houseRuleIcon(label) }))];

    const toggle = (label: string, checked: boolean) =>
      setValue((prev) => (checked ? [...prev, label] : prev.filter((v) => v !== label)));

    return (
      <div className="grid gap-3">
        <div>
          <Label>House rules</Label>
          <p className="mt-1 text-xs text-basalt/45">What guests can and can’t do. Shown, highlighted, on your listing page.</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
          {rows.map(({ label, icon: Icon }) => (
            <label key={label} className="flex items-center gap-2 text-sm text-basalt">
              <Checkbox
                checked={value.includes(label)}
                onCheckedChange={(checked) => toggle(label, checked === true)}
                className="rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot"
              />
              <Icon className="h-4 w-4 shrink-0 text-basalt/55" strokeWidth={1.75} />
              {label}
            </label>
          ))}
        </div>
      </div>
    );
  },
);
