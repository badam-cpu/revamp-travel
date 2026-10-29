/**
 * Admin → Community (revamp.community, migration 0125):
 *  - News: stories Aha AI found (drafts) to check, edit and publish or reject;
 *    "Find news now" runs the AI web search (also runs Mon + Thu by itself).
 *  - Meetups: add / edit / cancel, with saved seats.
 *  - Members: who joined (email, what they host, seats), CSV download.
 *  - Settings: the hosts' Telegram group link.
 * Writes are admin-RLS (news, meetups, settings); members are read-only here.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Download, ExternalLink, Loader2, Newspaper, Plus, Search, Settings, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { userMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  adminAddNews,
  adminDeleteMeetup,
  adminDeleteNews,
  adminFindNews,
  adminListMeetups,
  adminListMembers,
  adminListNews,
  adminSaveMeetup,
  adminSaveNews,
  adminSaveTelegramUrl,
  getCommunityTelegramUrl,
  type CommunityMemberRow,
  type MeetupInput,
  type NewsEdit,
} from "@/lib/community";
import { COMMUNITY_ORIGIN, HOSTS_OPTIONS, NEWS_CATEGORIES, formatMeetupWhen, formatNewsDate, meetupPlace, newsCategoryLabel, newsSlug, sourceLabel, type CommunityMeetup, type CommunityNewsItem, type NewsCategory } from "@shared/community";

type Tab = "news" | "meetups" | "members" | "settings";

const field = "h-11 w-full rounded-lg border border-basalt/20 bg-paper px-3 text-base outline-none focus:border-apricot sm:text-sm";
const area = "w-full rounded-lg border border-basalt/20 bg-paper px-3 py-2 text-base outline-none focus:border-apricot sm:text-sm";
const pill = (on: boolean) => cn("inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold", on ? "border-basalt bg-basalt text-paper" : "border-basalt/15 text-basalt/70 hover:border-basalt/35");

export function AdminCommunity() {
  const [tab, setTab] = useState<Tab>("news");
  return (
    <div>
      <PageHeader
        title="Community"
        sub="revamp.community — news for hosts, meetups and members."
        actions={
          <a href={`${COMMUNITY_ORIGIN}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-basalt/15 px-4 text-sm font-semibold text-basalt/70 hover:border-basalt/35">
            Open site <ExternalLink className="h-3.5 w-3.5" />
          </a>
        }
      />
      <div className="mb-6 flex flex-wrap gap-2">
        {([
          { k: "news", label: "News", icon: Newspaper },
          { k: "meetups", label: "Meetups", icon: CalendarDays },
          { k: "members", label: "Members", icon: Users },
          { k: "settings", label: "Settings", icon: Settings },
        ] as const).map((t) => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)} className={pill(tab === t.k)}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === "news" && <NewsTab />}
      {tab === "meetups" && <MeetupsTab />}
      {tab === "members" && <MembersTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

/* ── News ─────────────────────────────────────────────────────────────── */

const EMPTY_EDIT: NewsEdit = { category: "booking_sites", title: "", summary: "", forYou: "", sourceUrl: "", sourceName: "", storyDate: null };
const toEdit = (n: CommunityNewsItem): NewsEdit => ({ category: n.category, title: n.title, summary: n.summary, forYou: n.forYou, sourceUrl: n.sourceUrl, sourceName: n.sourceName, storyDate: n.storyDate });

function editProblem(e: NewsEdit): string | null {
  if (e.title.trim().length < 5) return "Add a headline.";
  if (!/^https:\/\//.test(e.sourceUrl.trim())) return "Add the source link (https://…).";
  if (!e.summary.trim()) return "Add a short summary.";
  return null;
}

function NewsTab() {
  const [status, setStatus] = useState<"draft" | "published" | "rejected">("draft");
  const [items, setItems] = useState<CommunityNewsItem[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [finding, setFinding] = useState(false);

  const load = useCallback(() => {
    setItems(null);
    adminListNews(status)
      .then(setItems)
      .catch((e) => {
        console.error(e);
        toast("Couldn't load the news. Has migration 0125 been run?");
        setItems([]);
      });
  }, [status]);
  useEffect(load, [load]);

  const find = async () => {
    setFinding(true);
    try {
      await adminFindNews();
      toast("Searching for news. New stories show under 'To check' in a few minutes.");
    } catch (e) {
      toast(userMessage(e, "Couldn't start the search."));
    } finally {
      setFinding(false);
    }
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {([
          ["draft", "To check"],
          ["published", "Published"],
          ["rejected", "Rejected"],
        ] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} className={pill(status === k)}>
            {label}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => setAdding(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-basalt/15 px-4 text-sm font-semibold hover:border-basalt/35">
            <Plus className="h-4 w-4" /> Add a story
          </button>
          <button type="button" onClick={find} disabled={finding} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-basalt px-4 text-sm font-semibold text-paper disabled:opacity-60">
            {finding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find news now
          </button>
        </div>
      </div>
      <p className="text-sm text-basalt/70">Aha AI searches the web every Monday and Thursday and adds stories here to check. Nothing appears on the site until you publish it. Check the source before publishing.</p>
      {adding && (
        <NewsEditor
          initial={EMPTY_EDIT}
          title="New story"
          onCancel={() => setAdding(false)}
          actions={[
            {
              label: "Save to check",
              run: async (e) => {
                await adminAddNews(e, newsSlug(e.title, crypto.randomUUID()));
                toast("Saved. It's under 'To check'.");
                setAdding(false);
                if (status === "draft") load();
                else setStatus("draft");
              },
            },
          ]}
        />
      )}
      {items === null ? (
        <div className="grid place-items-center py-16 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-basalt/20 p-6 text-sm text-basalt/70">
          {status === "draft" ? "Nothing to check right now. Use 'Find news now', or wait for Monday or Thursday's search." : status === "published" ? "Nothing published yet." : "Nothing rejected."}
        </p>
      ) : (
        <ul className="grid gap-3">
          {items.map((n) => <NewsItemRow key={n.id} item={n} onChanged={load} />)}
        </ul>
      )}
    </div>
  );
}

function NewsItemRow({ item, onChanged }: { item: CommunityNewsItem; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const save = async (edit: NewsEdit, status?: "draft" | "published" | "rejected") => {
    await adminSaveNews(item.id, edit, status);
    toast(status === "published" ? "Published on revamp.community." : status === "rejected" ? "Rejected." : status === "draft" ? "Moved back to 'To check'." : "Saved.");
    setEditing(false);
    onChanged();
  };
  if (editing) {
    const actions =
      item.status === "published"
        ? [{ label: "Save", run: (e: NewsEdit) => save(e) }, { label: "Unpublish", run: (e: NewsEdit) => save(e, "draft"), quiet: true }]
        : [{ label: "Publish", run: (e: NewsEdit) => save(e, "published") }, { label: "Save", run: (e: NewsEdit) => save(e), quiet: true }];
    return (
      <li>
        <NewsEditor initial={toEdit(item)} title="Edit story" onCancel={() => setEditing(false)} actions={actions} />
      </li>
    );
  }
  return (
    <li className="grid gap-2 rounded-xl border border-basalt/12 bg-paper p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold">
        <span className="uppercase tracking-[0.08em] text-apricot">{newsCategoryLabel(item.category)}</span>
        <span className="text-basalt/70">{formatNewsDate(item.storyDate)}</span>
        <span className="rounded-full bg-basalt/[0.06] px-2 py-0.5 text-basalt/70">{item.origin === "ai" ? "Found by Aha AI" : "Added by the team"}</span>
      </div>
      <p className="text-base font-extrabold leading-snug">{item.title}</p>
      <p className="text-sm leading-relaxed text-basalt/80">{item.summary}</p>
      {item.forYou && <p className="text-sm leading-relaxed"><span className="font-bold">For you:</span> {item.forYou}</p>}
      <a href={item.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm font-semibold text-basalt underline-offset-2 hover:underline">
        {sourceLabel(item)} <ExternalLink className="h-3.5 w-3.5" />
      </a>
      <div className="mt-1 flex flex-wrap gap-2">
        {item.status !== "published" && (
          <button type="button" onClick={() => save(toEdit(item), "published").catch((e) => toast(userMessage(e, "Couldn't publish.")))} className="min-h-10 rounded-full bg-apricot px-4 text-sm font-bold text-basalt">
            Publish
          </button>
        )}
        <button type="button" onClick={() => setEditing(true)} className="min-h-10 rounded-full border border-basalt/20 px-4 text-sm font-semibold">
          Edit
        </button>
        {item.status === "draft" && (
          <button type="button" onClick={() => save(toEdit(item), "rejected").catch((e) => toast(userMessage(e, "Couldn't reject.")))} className="min-h-10 rounded-full border border-basalt/20 px-4 text-sm font-semibold text-basalt/70">
            Reject
          </button>
        )}
        {item.status === "published" && (
          <a href={`${COMMUNITY_ORIGIN}/news/${item.slug}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1 rounded-full border border-basalt/20 px-4 text-sm font-semibold">
            View <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {item.status === "rejected" && (
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm("Delete this story for good? Aha AI may find it again later.")) return;
              try {
                await adminDeleteNews(item.id);
                onChanged();
              } catch (e) {
                toast(userMessage(e, "Couldn't delete."));
              }
            }}
            className="min-h-10 rounded-full border border-basalt/20 px-4 text-sm font-semibold text-basalt/70"
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

function NewsEditor({ initial, title, onCancel, actions }: { initial: NewsEdit; title: string; onCancel: () => void; actions: { label: string; run: (e: NewsEdit) => Promise<void>; quiet?: boolean }[] }) {
  const [e, setE] = useState<NewsEdit>(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof NewsEdit>(k: K, v: NewsEdit[K]) => setE((p) => ({ ...p, [k]: v }));
  const go = async (run: (e: NewsEdit) => Promise<void>) => {
    const problem = editProblem(e);
    if (problem) return toast(problem);
    setBusy(true);
    try {
      await run(e);
    } catch (err) {
      toast(userMessage(err, "Couldn't save."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3 rounded-xl border border-apricot/40 bg-paper p-4">
      <p className="font-extrabold">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Topic
          <select value={e.category} onChange={(ev) => set("category", ev.target.value as NewsCategory)} className={field}>
            {NEWS_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Story date
          <input type="date" value={e.storyDate ?? ""} onChange={(ev) => set("storyDate", ev.target.value || null)} className={field} />
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        Headline
        <input value={e.title} maxLength={160} onChange={(ev) => set("title", ev.target.value)} className={field} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Summary <span className="font-normal text-basalt/70">2–3 sentences in our own words</span>
        <textarea rows={3} maxLength={900} value={e.summary} onChange={(ev) => set("summary", ev.target.value)} className={area} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        What it means for you <span className="font-normal text-basalt/70">one practical line for hosts</span>
        <textarea rows={2} maxLength={400} value={e.forYou} onChange={(ev) => set("forYou", ev.target.value)} className={area} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Source link
          <input type="url" value={e.sourceUrl} onChange={(ev) => set("sourceUrl", ev.target.value)} placeholder="https://…" className={field} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Source name
          <input value={e.sourceName} maxLength={120} onChange={(ev) => set("sourceName", ev.target.value)} placeholder="e.g. Skift" className={field} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button key={a.label} type="button" disabled={busy} onClick={() => go(a.run)} className={cn("min-h-10 rounded-full px-4 text-sm font-bold disabled:opacity-60", a.quiet ? "border border-basalt/20" : "bg-apricot text-basalt")}>
            {a.label}
          </button>
        ))}
        <button type="button" onClick={onCancel} className="min-h-10 rounded-full px-4 text-sm font-semibold text-basalt/70">
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Meetups ──────────────────────────────────────────────────────────── */

/** "2026-11-12T19:00" (Armenia, UTC+4, no DST) ↔ ISO. */
const toLocalInput = (iso: string) => new Date(new Date(iso).getTime() + 4 * 3_600_000).toISOString().slice(0, 16);
const fromLocalInput = (v: string) => new Date(`${v}:00+04:00`).toISOString();

function MeetupsTab() {
  const [items, setItems] = useState<(CommunityMeetup & { seats: number })[] | null>(null);
  const [editing, setEditing] = useState<CommunityMeetup | "new" | null>(null);
  const load = useCallback(() => {
    adminListMeetups()
      .then(setItems)
      .catch((e) => {
        console.error(e);
        setItems([]);
      });
  }, []);
  useEffect(load, [load]);
  const now = Date.now();
  return (
    <div className="grid gap-4">
      <div className="flex">
        <button type="button" onClick={() => setEditing("new")} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-basalt px-4 text-sm font-semibold text-paper">
          <Plus className="h-4 w-4" /> Add a meetup
        </button>
      </div>
      {editing && <MeetupEditor existing={editing === "new" ? null : editing} onDone={() => { setEditing(null); load(); }} />}
      {items === null ? (
        <div className="grid place-items-center py-16 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-basalt/20 p-6 text-sm text-basalt/70">No meetups yet. Until there's one, the site says "The next date is coming soon".</p>
      ) : (
        <ul className="grid gap-2">
          {items.map((m) => {
            const w = formatMeetupWhen(m.startsAt);
            const past = Date.parse(m.startsAt) < now;
            return (
              <li key={m.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-basalt/12 bg-paper p-4", past && "opacity-70")}>
                <div className="w-32 text-sm font-bold">{w.day}<span className="block font-normal text-basalt/70">{w.time}</span></div>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold">{m.title}</p>
                  <p className="text-sm text-basalt/70">{meetupPlace(m)}</p>
                </div>
                <span className="text-sm font-semibold">{m.seats} seat{m.seats === 1 ? "" : "s"} saved</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold uppercase", m.status === "published" ? "bg-emerald-50 text-emerald-800" : m.status === "cancelled" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800")}>
                  {past && m.status === "published" ? "past" : m.status === "published" ? "on the site" : m.status}
                </span>
                <button type="button" onClick={() => setEditing(m)} className="min-h-10 rounded-full border border-basalt/20 px-4 text-sm font-semibold">Edit</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MeetupEditor({ existing, onDone }: { existing: CommunityMeetup | null; onDone: () => void }) {
  const [m, setM] = useState<MeetupInput>(() =>
    existing
      ? { title: existing.title, description: existing.description, startsAt: existing.startsAt, venue: existing.venue, city: existing.city, online: existing.online, status: existing.status }
      : { title: "", description: "", startsAt: "", venue: "", city: "Yerevan", online: false, status: "published" },
  );
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof MeetupInput>(k: K, v: MeetupInput[K]) => setM((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (m.title.trim().length < 3) return toast("Add a title.");
    if (!m.startsAt) return toast("Pick the date and time.");
    setBusy(true);
    try {
      await adminSaveMeetup(existing?.id ?? null, m);
      toast("Meetup saved.");
      onDone();
    } catch (e) {
      toast(userMessage(e, "Couldn't save the meetup."));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!existing || !window.confirm("Delete this meetup and its saved seats? To tell people it's off, set it to Cancelled instead.")) return;
    try {
      await adminDeleteMeetup(existing.id);
      onDone();
    } catch (e) {
      toast(userMessage(e, "Couldn't delete."));
    }
  };
  return (
    <div className="grid gap-3 rounded-xl border border-apricot/40 bg-paper p-4">
      <p className="font-extrabold">{existing ? "Edit meetup" : "New meetup"}</p>
      <label className="grid gap-1 text-sm font-semibold">
        Topic
        <input value={m.title} maxLength={140} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Pricing for the winter season" className={field} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-semibold">
          Date and time (Armenia)
          <input type="datetime-local" value={m.startsAt ? toLocalInput(m.startsAt) : ""} onChange={(e) => set("startsAt", e.target.value ? fromLocalInput(e.target.value) : "")} className={field} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Venue
          <input value={m.venue} maxLength={160} onChange={(e) => set("venue", e.target.value)} placeholder="e.g. a café or coworking" className={field} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          City
          <input value={m.city} maxLength={80} onChange={(e) => set("city", e.target.value)} className={field} />
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        A line about it <span className="font-normal text-basalt/70">optional</span>
        <textarea rows={2} maxLength={1200} value={m.description} onChange={(e) => set("description", e.target.value)} className={area} />
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={m.online} onChange={(e) => set("online", e.target.checked)} className="h-4 w-4 accent-apricot" /> Also online
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          Status
          <select value={m.status} onChange={(e) => set("status", e.target.value as MeetupInput["status"])} className="h-10 rounded-lg border border-basalt/20 bg-paper px-2 text-sm">
            <option value="published">On the site</option>
            <option value="draft">Hidden (draft)</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-basalt/70">People who save a seat get a confirmation email. The online link isn't stored here; send it to them from Campaigns → Host community.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={save} className="min-h-10 rounded-full bg-apricot px-4 text-sm font-bold text-basalt disabled:opacity-60">Save</button>
        <button type="button" onClick={onDone} className="min-h-10 rounded-full px-4 text-sm font-semibold text-basalt/70">Cancel</button>
        {existing && <button type="button" onClick={remove} className="ml-auto min-h-10 rounded-full px-4 text-sm font-semibold text-red-700">Delete</button>}
      </div>
    </div>
  );
}

/* ── Members ──────────────────────────────────────────────────────────── */

function MembersTab() {
  const [rows, setRows] = useState<CommunityMemberRow[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    adminListMembers()
      .then(setRows)
      .catch((e) => {
        console.error(e);
        setRows([]);
      });
  }, []);
  const hostsLabel = (k: string) => HOSTS_OPTIONS.find((o) => o.key === k)?.label ?? k;
  const shown = (rows ?? []).filter((r) => !q.trim() || `${r.email} ${r.name ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const csv = () => {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [["email", "name", "hosts", "joined", "unsubscribed", "meetups"].join(","), ...(rows ?? []).map((r) => [r.email, r.name ?? "", hostsLabel(r.hosts), r.createdAt.slice(0, 10), r.unsubscribedAt ? r.unsubscribedAt.slice(0, 10) : "", r.meetups.join("; ")].map(cell).join(","))];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `revamp-community-members-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  if (rows === null) return <div className="grid place-items-center py-16 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  const active = rows.filter((r) => !r.unsubscribedAt).length;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm"><span className="text-lg font-extrabold">{active}</span> member{active === 1 ? "" : "s"}{rows.length > active ? ` · ${rows.length - active} unsubscribed` : ""}</p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email or name" className={cn(field, "ml-auto max-w-xs")} aria-label="Search members" />
        <button type="button" onClick={csv} disabled={rows.length === 0} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-basalt/20 px-4 text-sm font-semibold disabled:opacity-50">
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>
      <p className="text-sm text-basalt/70">To email members, use Campaigns and choose the audience "Host community (revamp.community)".</p>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-basalt/20 p-6 text-sm text-basalt/70">{rows.length === 0 ? "No one has joined yet." : "No match."}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-basalt/12">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-basalt/[0.03] text-xs uppercase tracking-wide text-basalt/70">
              <tr><th className="px-4 py-2">Email</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Hosts</th><th className="px-4 py-2">Joined</th><th className="px-4 py-2">Meetups</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={cn("border-t border-basalt/10", r.unsubscribedAt && "text-basalt/50")}>
                  <td className="px-4 py-2.5 font-semibold">{r.email}{r.unsubscribedAt && <span className="ml-2 text-xs font-normal">unsubscribed</span>}</td>
                  <td className="px-4 py-2.5">{r.name ?? "—"}</td>
                  <td className="px-4 py-2.5">{hostsLabel(r.hosts)}</td>
                  <td className="px-4 py-2.5">{formatNewsDate(r.createdAt)}</td>
                  <td className="px-4 py-2.5">{r.meetups.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Settings ─────────────────────────────────────────────────────────── */

function SettingsTab() {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getCommunityTelegramUrl().then((u) => setUrl(u ?? ""));
  }, []);
  const save = async () => {
    const v = (url ?? "").trim();
    if (v && !/^https:\/\/(t\.me|telegram\.me)\//.test(v)) return toast("Use a Telegram invite link (https://t.me/…).");
    setBusy(true);
    try {
      await adminSaveTelegramUrl(v || null);
      toast(v ? "Saved. The site shows 'Join the hosts' group on Telegram'." : "Removed. The Telegram button is hidden.");
    } catch (e) {
      toast(userMessage(e, "Couldn't save."));
    } finally {
      setBusy(false);
    }
  };
  if (url === null) return <div className="grid place-items-center py-16 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  return (
    <div className="grid max-w-xl gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        Hosts' Telegram group <span className="font-normal text-basalt/70">Invite link. Shown on the site and in the welcome email. Leave empty to hide it.</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://t.me/+…" className={field} />
      </label>
      <button type="button" disabled={busy} onClick={save} className="min-h-10 self-start rounded-full bg-apricot px-5 text-sm font-bold text-basalt disabled:opacity-60">Save</button>
    </div>
  );
}
