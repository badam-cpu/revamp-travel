/**
 * A time-of-day dropdown for the listing form (check-in from / checkout by) —
 * hourly times like "3:00 PM" plus "Flexible", the way booking platforms offer
 * them. A plain <select name=…> so the uncontrolled form reads it at submit like
 * every other field. Older free-text values ("3 pm", "15:00") are normalized
 * onto the list; anything unrecognized is kept as its own option so editing a
 * listing never loses what the operator wrote.
 */
const HOURS: string[] = Array.from({ length: 24 }, (_, h) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`);
export const TIME_OPTIONS = ["Flexible", ...HOURS];

/** "3 pm" / "3:00pm" / "15:00" / "15.30" → "3:00 PM" / "3:30 PM"; unrecognized → as typed. */
export function normalizeTime(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (/^flex/i.test(v)) return "Flexible";
  const m = v.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
  if (!m) return v;
  let h = Number(m[1]);
  const min = m[2] ?? "00";
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (h > 23 || Number(min) > 59) return v;
  if (ap) {
    if (h < 1 || h > 12) return v;
    h = (h % 12) + (ap === "pm" ? 12 : 0);
  }
  return `${h % 12 === 0 ? 12 : h % 12}:${min} ${h < 12 ? "AM" : "PM"}`;
}

export function TimeSelect({ id, name, defaultValue, className }: { id: string; name: string; defaultValue?: string; className?: string }) {
  const current = normalizeTime(defaultValue ?? "");
  const options = current && !TIME_OPTIONS.includes(current) ? [current, ...TIME_OPTIONS] : TIME_OPTIONS;
  return (
    <select id={id} name={name} defaultValue={current} className={className}>
      <option value="">Not set</option>
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
