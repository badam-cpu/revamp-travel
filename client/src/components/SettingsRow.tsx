/**
 * One row of a settings page: what it is (title + one line of help) on the
 * left, the control on the right; stacks on phones. Rows are separated by a
 * hairline by the parent list (divide-y).
 */
export function SettingsRow({ title, help, htmlFor, children }: { title: string; help?: React.ReactNode; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 py-6 first:pt-0 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
      <div>
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-semibold text-basalt">{title}</label>
        ) : (
          <p className="text-sm font-semibold text-basalt">{title}</p>
        )}
        {help && <p className="mt-1 text-sm leading-6 text-basalt/60">{help}</p>}
      </div>
      {/* One control width for every row, so fields line up across tabs. */}
      <div className="min-w-0 max-w-xl">{children}</div>
    </div>
  );
}
