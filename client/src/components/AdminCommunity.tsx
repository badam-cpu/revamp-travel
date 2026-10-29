/**
 * Admin → Community (revamp.community, migration 0125):
 *  - News: stories Aha AI found (drafts) to check, edit and publish or reject;
 *    "Find news now" runs the AI web search (also runs Mon + Thu by itself).
 *    Each AI story is written from its article and checked against it (0127);
 *    the row shows what that check found. "Write detailed version" rewrites
 *    older or edited stories the same way (they go back to "To check").
 *  - Meetups: add / edit / cancel, with saved seats.
 *  - Members: who joined (email, what they host, seats), CSV download.
 *  - Settings: the hosts' Telegram group link.
 * Writes are admin-RLS (news, meetups, settings); members are read-only here.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarDays, Download, ExternalLink, Library, Loader2, Newspaper, Plus, RefreshCw, Search, Settings, ShieldCheck, Sparkles, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { userMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  adminAddNews,
  adminDeleteMeetup,
  adminDeleteNews,
  adminFindNews,
  adminRewriteNews,
  adminListMeetups,
  adminListMembers,
  adminListNews,
  adminSaveMeetup,
  adminSaveNews,
  adminSaveTelegramUrl,
  adminListSources,
  adminSaveSource,
  adminSetSourceActive,
  adminDeleteSource,
  adminCheckSource,
  adminSetNewsWiderSearch,
  getCommunityTelegramUrl,
  getNewsWiderSearch,
  type NewsSourceRow,
  type CommunityMemberRow,
  type MeetupInput,
  type NewsEdit,
} from "@/lib/community";
import { COMMUNITY_ORIGIN, HOSTS_OPTIONS, NEWS_CATEGORIES, formatMeetupWhen, formatNewsDate, meetupPlace, newsCategoryLabel, newsSlug, sourceLabel, type CommunityMeetup, type CommunityNewsItem, type NewsCategory } from "@shared/community";

type Tab = "news" | "sources" | "meetups" | "members" | "settings";

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
          { k: "sources", label: "Sources", icon: Library },
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
      {tab === "sources" && <SourcesTab />}
      {tab === "meetups" && <MeetupsTab />}
      {tab === "members" && <MembersTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

/* ── News ─────────────────────────────────────────────────────────────── */

const EMPTY_EDIT: NewsEdit = { category: "booking_sites", title: "", summary: "", forYou: "", keyPoints: [], sourceUrl: "", sourceName: "", storyDate: null };
const toEdit = (n: CommunityNewsItem): NewsEdit => ({ category: n.category, title: n.title, summary: n.summary, forYou: n.forYou, keyPoints: n.keyPoints, sourceUrl: n.sourceUrl, sourceName: n.sourceName, storyDate: n.storyDate });

/** Start "Write detailed version" for some stories, with the toast either way. */
async function startRewrite(ids: string[], wasPublished: boolean): Promise<boolean> {
  if (wasPublished && !window.confirm("The new version goes to 'To check', so this story is off revamp.community until you publish it again. Continue?")) return false;
  try {
    await adminRewriteNews(ids);
    toast(`Aha AI is reading ${ids.length === 1 ? "the article" : "the articles"} and checking each detail. Refresh 'To check' in a minute or two.`);
    return true;
  } catch (e) {
    toast(userMessage(e, "Couldn't start the rewrite."));
    return false;
  }
}

/** What the check against the article found — shown on each story for the reviewing admin. */
function CheckSummary({ item }: { item: CommunityNewsItem }) {
  const c = item.checks;
  if (c.failed) {
    return (
      <p className="flex items-start gap-1.5 rounded-lg bg-apricot-soft px-3 py-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-apricot" /> {c.failed} The story is unchanged.
      </p>
    );
  }
  if (!item.verifiedAt) {
    return <p className="text-sm text-basalt/70">Not checked against the article yet. Use "Write detailed version" to have Aha AI rewrite and check it.</p>;
  }
  const notes = [...(c.unconfirmed ?? []).map((x) => ({ kind: "Couldn't find the article's wording for", text: x })), ...(c.corrected ?? []).map((x) => ({ kind: "Corrected", text: x })), ...(c.removed ?? []).map((x) => ({ kind: "Removed", text: x }))];
  const parts = [`${c.confirmed ?? 0} detail${c.confirmed === 1 ? "" : "s"} confirmed`, c.corrected?.length ? `${c.corrected.length} corrected` : "", c.removed?.length ? `${c.removed.length} removed` : "", c.unconfirmed?.length ? `${c.unconfirmed.length} to check yourself` : ""].filter(Boolean);
  return (
    <details className="rounded-lg bg-basalt/[0.04] px-3 py-2 text-sm">
      <summary className={cn("flex min-h-8 cursor-pointer list-none items-center gap-1.5 font-semibold", c.unconfirmed?.length ? "text-apricot" : "text-basalt")}>
        {c.unconfirmed?.length ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <ShieldCheck className="h-4 w-4 shrink-0" />}
        Checked against the article: {parts.join(" · ")}
      </summary>
      {notes.length > 0 ? (
        <ul className="mt-2 grid gap-1.5 pb-1 text-basalt/80">
          {notes.map((n, i) => (
            <li key={i}><span className="font-semibold text-basalt">{n.kind}:</span> {n.text}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 pb-1 text-basalt/70">Every detail matched the article's own words.</p>
      )}
    </details>
  );
}

function editProblem(e: NewsEdit): string | null {
  if (e.title.trim().length < 5) return "Add a headline.";
  if (!/^https:\/\//.test(e.sourceUrl.trim())) return "Add the source link (https://…).";
  if (!e.summary.trim()) return "Add a short summary.";
  if (e.keyPoints.filter((k) => k.trim()).length > 8) return "Keep it to 8 key points at most.";
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
      <p className="text-sm text-basalt/70">Every Monday and Thursday Aha AI reads your sources (see Sources), writes each story from its article and checks every detail against it. Stories land here to check — nothing appears on the site until you publish it. A story whose article can't be opened is left out.</p>
      {items && status !== "rejected" && items.some((n) => !n.verifiedAt) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-apricot-soft px-4 py-3 text-sm">
          <span className="min-w-0 flex-1">{items.filter((n) => !n.verifiedAt).length} {status === "published" ? "published " : ""}stor{items.filter((n) => !n.verifiedAt).length === 1 ? "y was" : "ies were"} written before detailed, checked digests.</span>
          <button
            type="button"
            onClick={async () => {
              if (await startRewrite(items.filter((n) => !n.verifiedAt).map((n) => n.id), status === "published")) load();
            }}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-basalt px-4 font-semibold text-paper"
          >
            <Sparkles className="h-4 w-4" /> Rewrite {items.filter((n) => !n.verifiedAt).length === 1 ? "it" : "them"}
          </button>
        </div>
      )}
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
      {item.keyPoints.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-basalt/80">
          {item.keyPoints.map((k, i) => <li key={i}>{k}</li>)}
        </ul>
      )}
      {item.forYou && <p className="text-sm leading-relaxed"><span className="font-bold">For you:</span> {item.forYou}</p>}
      <a href={item.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm font-semibold text-basalt underline-offset-2 hover:underline">
        {sourceLabel(item)} <ExternalLink className="h-3.5 w-3.5" />
      </a>
      {item.status !== "rejected" && <CheckSummary item={item} />}
      <div className="mt-1 flex flex-wrap gap-2">
        {item.status !== "published" && (
          <button type="button" onClick={() => save(toEdit(item), "published").catch((e) => toast(userMessage(e, "Couldn't publish.")))} className="min-h-10 rounded-full bg-apricot hover:bg-apricot/90 px-4 text-sm font-bold text-white">
            Publish
          </button>
        )}
        <button type="button" onClick={() => setEditing(true)} className="min-h-10 rounded-full border border-basalt/20 px-4 text-sm font-semibold">
          Edit
        </button>
        {item.status !== "rejected" && (
          <button
            type="button"
            onClick={async () => {
              if (await startRewrite([item.id], item.status === "published")) onChanged();
            }}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-basalt/20 px-4 text-sm font-semibold"
          >
            <Sparkles className="h-4 w-4" /> {item.verifiedAt ? "Rewrite & check again" : "Write detailed version"}
          </button>
        )}
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
        Key points <span className="font-normal text-basalt/70">one fact per line — who, what changes, dates, numbers (3–6)</span>
        <textarea rows={5} value={e.keyPoints.join("\n")} onChange={(ev) => set("keyPoints", ev.target.value.split("\n"))} className={area} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        What it means for you <span className="font-normal text-basalt/70">1–2 practical sentences for hosts</span>
        <textarea rows={2} maxLength={600} value={e.forYou} onChange={(ev) => set("forYou", ev.target.value)} className={area} />
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
          <button key={a.label} type="button" disabled={busy} onClick={() => go(a.run)} className={cn("min-h-10 rounded-full px-4 text-sm font-bold disabled:opacity-60", a.quiet ? "border border-basalt/20" : "bg-apricot hover:bg-apricot/90 text-white")}>
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
        <button type="button" disabled={busy} onClick={save} className="min-h-10 rounded-full bg-apricot hover:bg-apricot/90 px-4 text-sm font-bold text-white disabled:opacity-60">Save</button>
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
  const [wider, setWider] = useState<boolean | null>(null);
  useEffect(() => {
    getCommunityTelegramUrl().then((u) => setUrl(u ?? ""));
    getNewsWiderSearch().then(setWider).catch(() => setWider(true));
  }, []);
  const toggleWider = async (on: boolean) => {
    setWider(on);
    try {
      await adminSetNewsWiderSearch(on);
      toast(on ? "Aha AI will also do a short wider search." : "Aha AI will use your sources only.");
    } catch (e) {
      setWider(!on);
      toast(userMessage(e, "Couldn't save. Has migration 0126 been run?"));
    }
  };
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
      <button type="button" disabled={busy} onClick={save} className="min-h-10 self-start rounded-full bg-apricot hover:bg-apricot/90 px-5 text-sm font-bold text-white disabled:opacity-60">Save</button>
      <label className="mt-6 flex items-start gap-3 rounded-xl border border-basalt/12 p-4 text-sm">
        <input type="checkbox" checked={wider ?? true} disabled={wider === null} onChange={(e) => toggleWider(e.target.checked)} className="mt-0.5 h-5 w-5 accent-apricot" />
        <span>
          <span className="font-semibold">Also do a short wider search</span>
          <span className="mt-0.5 block text-basalt/70">After reading your sources, Aha AI runs a few web searches for what they don't cover: travel to Armenia, Armenian rules and taxes, and big booking-site changes. Off = your sources only (cheaper, may miss Armenia news).</span>
        </span>
      </label>
    </div>
  );
}

/* ── Sources (0126) ───────────────────────────────────────────────────── */

const EMPTY_SOURCE = { groupLabel: "", name: "", siteUrl: "", feedUrl: "", active: true };

function feedLabel(s: NewsSourceRow): { text: string; tone: string } {
  if (s.feedUrl && s.feedStatus === "ok") return { text: s.lastItemAt ? `Feed · last post ${formatNewsDate(s.lastItemAt)}` : "Feed", tone: "bg-emerald-50 text-emerald-800" };
  if (s.feedStatus === "error") return { text: "Feed failed — searched instead", tone: "bg-amber-50 text-amber-800" };
  if (s.feedStatus === "none") return { text: "No feed — searched instead", tone: "bg-basalt/[0.06] text-basalt/70" };
  return { text: "Not checked yet", tone: "bg-basalt/[0.06] text-basalt/70" };
}

function SourcesTab() {
  const [rows, setRows] = useState<NewsSourceRow[] | null>(null);
  const [editing, setEditing] = useState<NewsSourceRow | "new" | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const load = useCallback(() => {
    adminListSources()
      .then(setRows)
      .catch((e) => {
        console.error(e);
        toast("Couldn't load the sources. Has migration 0126 been run?");
        setRows([]);
      });
  }, []);
  useEffect(load, [load]);

  const check = async (s: NewsSourceRow) => {
    setChecking(s.id);
    try {
      const r = await adminCheckSource(s.id);
      toast(r.feedUrl ? "Feed found — Aha AI will read it." : r.note || "No feed on that site — Aha AI will search it instead.");
      load();
    } catch (e) {
      toast(userMessage(e, "Couldn't check that site right now."));
    } finally {
      setChecking(null);
    }
  };
  const toggle = async (s: NewsSourceRow) => {
    try {
      await adminSetSourceActive(s.id, !s.active);
      load();
    } catch (e) {
      toast(userMessage(e, "Couldn't save."));
    }
  };

  if (rows === null) return <div className="grid place-items-center py-16 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  const groups = Array.from(new Set(rows.map((r) => r.groupLabel || "Other")));
  const withFeed = rows.filter((r) => r.active && r.feedUrl && r.feedStatus === "ok").length;
  const active = rows.filter((r) => r.active).length;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm"><span className="text-lg font-extrabold">{active}</span> active source{active === 1 ? "" : "s"} · {withFeed} read by feed, the rest searched</p>
        <button type="button" onClick={() => setEditing("new")} className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-full bg-basalt px-4 text-sm font-semibold text-paper">
          <Plus className="h-4 w-4" /> Add a source
        </button>
      </div>
      <p className="text-sm text-basalt/70">Aha AI reads sources with a news feed directly (free, and every link is real). Sites without one, or that block automated readers, are covered by a web search limited to those sites. Pause a source to leave it out.</p>
      {editing && <SourceEditor existing={editing === "new" ? null : editing} groups={groups} onDone={() => { setEditing(null); load(); }} />}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-basalt/20 p-6 text-sm text-basalt/70">No sources yet. Add the sites you trust.</p>
      ) : (
        groups.map((g) => (
          <section key={g} className="grid gap-2">
            <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-basalt/70">{g}</h3>
            <ul className="grid gap-2">
              {rows.filter((r) => (r.groupLabel || "Other") === g).map((s) => {
                const f = feedLabel(s);
                return (
                  <li key={s.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-basalt/12 bg-paper p-3", !s.active && "opacity-60")}>
                    <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                      <p className="font-semibold">{s.name}</p>
                      <a href={s.siteUrl} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 truncate text-xs text-basalt/70 hover:underline">{s.siteUrl.replace(/^https:\/\/(www\.)?/, "")} <ExternalLink className="h-3 w-3 shrink-0" /></a>
                    </div>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", f.tone)} title={s.lastError ?? undefined}>{s.active ? f.text : "Paused"}</span>
                    <button type="button" onClick={() => check(s)} disabled={checking === s.id} className="inline-flex min-h-10 items-center gap-1 rounded-full border border-basalt/20 px-3 text-sm font-semibold disabled:opacity-60" aria-label={`Check ${s.name} for a feed`}>
                      <RefreshCw className={cn("h-3.5 w-3.5", checking === s.id && "animate-spin")} /> Check
                    </button>
                    <button type="button" onClick={() => toggle(s)} className="min-h-10 rounded-full border border-basalt/20 px-3 text-sm font-semibold">{s.active ? "Pause" : "Resume"}</button>
                    <button type="button" onClick={() => setEditing(s)} className="min-h-10 rounded-full border border-basalt/20 px-3 text-sm font-semibold">Edit</button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function SourceEditor({ existing, groups, onDone }: { existing: NewsSourceRow | null; groups: string[]; onDone: () => void }) {
  const [s, setS] = useState(() => (existing ? { groupLabel: existing.groupLabel, name: existing.name, siteUrl: existing.siteUrl, feedUrl: existing.feedUrl ?? "", active: existing.active } : EMPTY_SOURCE));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof EMPTY_SOURCE>(k: K, v: (typeof EMPTY_SOURCE)[K]) => setS((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (s.name.trim().length < 2) return toast("Add the source's name.");
    if (!/^https:\/\//.test(s.siteUrl.trim())) return toast("Add the website (https://…).");
    if (s.feedUrl.trim() && !/^https:\/\//.test(s.feedUrl.trim())) return toast("The feed link must start with https://");
    setBusy(true);
    try {
      await adminSaveSource(existing?.id ?? null, { ...s, feedUrl: s.feedUrl.trim() || null, sort: existing?.sort ?? 1000 });
      toast(s.feedUrl.trim() ? "Saved." : "Saved. Use Check to look for its news feed.");
      onDone();
    } catch (e) {
      toast(userMessage(e, "Couldn't save the source."));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!existing || !window.confirm(`Remove ${existing.name}? Stories already found from it stay.`)) return;
    try {
      await adminDeleteSource(existing.id);
      onDone();
    } catch (e) {
      toast(userMessage(e, "Couldn't remove it."));
    }
  };
  return (
    <div className="grid gap-3 rounded-xl border border-apricot/40 bg-paper p-4">
      <p className="font-extrabold">{existing ? "Edit source" : "New source"}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Name
          <input value={s.name} maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Skift" className={field} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Group
          <input value={s.groupLabel} maxLength={80} list="community-source-groups" onChange={(e) => set("groupLabel", e.target.value)} placeholder="e.g. Short-term rentals" className={field} />
          <datalist id="community-source-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        Website
        <input type="url" value={s.siteUrl} onChange={(e) => set("siteUrl", e.target.value)} placeholder="https://…" className={field} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        News feed (RSS) <span className="font-normal text-basalt/70">optional — leave empty and use Check to find it</span>
        <input type="url" value={s.feedUrl} onChange={(e) => set("feedUrl", e.target.value)} placeholder="https://…/feed/" className={field} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={save} className="min-h-10 rounded-full bg-apricot hover:bg-apricot/90 px-4 text-sm font-bold text-white disabled:opacity-60">Save</button>
        <button type="button" onClick={onDone} className="min-h-10 rounded-full px-4 text-sm font-semibold text-basalt/70">Cancel</button>
        {existing && <button type="button" onClick={remove} className="ml-auto min-h-10 rounded-full px-4 text-sm font-semibold text-red-700">Remove</button>}
      </div>
    </div>
  );
}
