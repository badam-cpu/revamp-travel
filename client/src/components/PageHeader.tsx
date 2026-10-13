/**
 * The one header for every dashboard / admin page: a compact title, one short
 * line of description, and optional actions on the right. Pages are working
 * surfaces — the content, not the heading, should own the first screen.
 * SubHeader is for a section inside a page.
 */
import { cn } from "@/lib/utils";

export function PageHeader({ title, sub, actions, className }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        <h1 className="font-display text-[1.75rem] leading-tight tracking-[-0.02em] [text-wrap:balance] sm:text-[2rem]">{title}</h1>
        {sub && <p className="mt-1.5 max-w-2xl text-[15px] leading-6 text-basalt/60">{sub}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export function SubHeader({ title, sub, actions, className }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
        {sub && <p className="mt-1 max-w-2xl text-sm leading-6 text-basalt/60">{sub}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
