/**
 * Admin-only editor for site content (home hero image/headline/subcopy,
 * featured listings, announcement banner) — rendered on /admin alongside the
 * review queue. Writes the single `site_settings` row directly under the
 * admin's session; RLS (is_admin) is what actually authorizes it, not this UI.
 * Reads/refreshes through SiteSettingsContext so the change shows up live.
 */
import { useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { useListings } from "@/contexts/ListingsContext";
import { PhotoUploader, PhotoUploaderHandle } from "@/components/PhotoUploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

// The four home "choose the route" cards, with their built-in defaults (used as
// placeholders so an admin sees what a blank field falls back to).
const HOME_CATS = [
  { type: "stay", name: "Stay", title: "Stay with a sense of place", label: "Homes, cabins & small hotels" },
  { type: "eat", name: "Eat", title: "Taste the landscape", label: "Tables, cellars & courtyards" },
  { type: "tour", name: "Tour", title: "Go with someone local", label: "Walks, routes & field days" },
  { type: "experience", name: "Experience", title: "Make something with your hands", label: "Classes, crafts & tastings" },
];

export function AdminSiteContent() {
  const { settings, loading, refresh } = useSiteSettings();
  const { listings } = useListings();
  const photosRef = useRef<PhotoUploaderHandle>(null);

  const [hydrated, setHydrated] = useState(false);
  const [headline, setHeadline] = useState("");
  const [subcopy, setSubcopy] = useState("");
  const [featuredSlugs, setFeaturedSlugs] = useState<string[]>([]);
  const [annEnabled, setAnnEnabled] = useState(false);
  const [annMessage, setAnnMessage] = useState("");
  const [annHref, setAnnHref] = useState("");
  const [rate, setRate] = useState("");
  const [catEyebrow, setCatEyebrow] = useState("");
  const [catTitle, setCatTitle] = useState("");
  const [homeCats, setHomeCats] = useState<Record<string, { title: string; label: string }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the form once the settings row has loaded.
  useEffect(() => {
    if (loading || hydrated) return;
    setHeadline(settings.heroHeadline);
    setSubcopy(settings.heroSubcopy);
    setFeaturedSlugs(settings.featuredSlugs);
    setAnnEnabled(settings.announcementEnabled);
    setAnnMessage(settings.announcementMessage);
    setAnnHref(settings.announcementHref);
    setRate(settings.usdToAmdRate ? String(settings.usdToAmdRate) : "");
    setCatEyebrow(settings.homeContent.categoriesEyebrow ?? "");
    setCatTitle(settings.homeContent.categoriesTitle ?? "");
    const hc = settings.homeContent.categories ?? {};
    setHomeCats(Object.fromEntries(HOME_CATS.map((c) => [c.type, { title: hc[c.type]?.title ?? "", label: hc[c.type]?.label ?? "" }])));
    setHydrated(true);
  }, [loading, hydrated, settings]);

  const published = listings.filter((l) => l.status === "published");

  const toggleFeatured = (slug: string) =>
    setFeaturedSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const heroImage = photosRef.current?.getValue()[0] ?? settings.heroImage;
      const { error: err } = await supabase
        .from("site_settings")
        .update({
          hero_image: heroImage || "",
          hero_headline: headline.trim(),
          hero_subcopy: subcopy.trim(),
          featured_slugs: featuredSlugs,
          announcement_enabled: annEnabled,
          announcement_message: annMessage.trim(),
          announcement_href: annHref.trim(),
          usd_to_amd_rate: Number(rate) || 0,
          home_content: {
            categoriesEyebrow: catEyebrow.trim(),
            categoriesTitle: catTitle.trim(),
            categories: Object.fromEntries(
              HOME_CATS.map((c) => [c.type, { title: (homeCats[c.type]?.title ?? "").trim(), label: (homeCats[c.type]?.label ?? "").trim() }]),
            ),
          },
        })
        .eq("id", 1);
      if (err) throw new Error(err.message);
      await refresh();
      toast("Site content updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save site content.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-14 border-t border-basalt/10 pt-10">
      <p className="eyebrow">Site content</p>
      <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Edit the home page.</h2>
      <p className="mt-2 max-w-xl text-sm text-basalt/55">
        Everything here is optional — leave a field blank to keep the built-in default. Changes go live immediately.
      </p>

      <div className="mt-8 grid max-w-3xl gap-8">
        {/* Hero */}
        <div className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Home hero</p>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Hero photo <span className="font-normal text-basalt/45">(first photo is used)</span></Label>
            <PhotoUploader key={hydrated ? "ready" : "loading"} ref={photosRef} defaultValue={settings.heroImage ? [settings.heroImage] : []} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="heroHeadline" className="text-sm font-semibold">Headline <span className="font-normal text-basalt/45">(blank = “Stay. Experience. Repeat.”)</span></Label>
            <Input id="heroHeadline" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Stay. Experience. Repeat." className="h-11 rounded-none" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="heroSubcopy" className="text-sm font-semibold">Sub-copy</Label>
            <Textarea id="heroSubcopy" rows={2} value={subcopy} onChange={(e) => setSubcopy(e.target.value)} placeholder="Exceptional stays, Armenian tables, and local routes…" className="rounded-none text-base" />
          </div>
        </div>

        {/* Featured */}
        <div className="grid gap-3 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Featured listings</p>
          <p className="text-xs text-basalt/50">Pick which published listings appear in the home “Featured” row (leave all unchecked for the automatic pick).</p>
          {published.length === 0 ? (
            <p className="text-sm text-basalt/45">No published listings yet.</p>
          ) : (
            <div className="grid max-h-64 gap-1.5 overflow-y-auto">
              {published.map((l) => (
                <label key={l.id} className="flex items-center gap-3 text-sm text-basalt">
                  <Checkbox
                    checked={featuredSlugs.includes(l.slug)}
                    onCheckedChange={() => toggleFeatured(l.slug)}
                    className="rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot"
                  />
                  <span className="truncate">{l.title}</span>
                  <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/40">{l.type}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Announcement */}
        <div className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Announcement banner</p>
          <label className="flex items-center gap-3 text-sm">
            <Checkbox
              checked={annEnabled}
              onCheckedChange={(c) => setAnnEnabled(c === true)}
              className="rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot"
            />
            Show a site-wide banner
          </label>
          <div className="grid gap-2">
            <Label htmlFor="annMessage" className="text-sm font-semibold">Message</Label>
            <Input id="annMessage" value={annMessage} onChange={(e) => setAnnMessage(e.target.value)} placeholder="New experiences now live across Armenia" className="h-11 rounded-none" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="annHref" className="text-sm font-semibold">Link <span className="font-normal text-basalt/45">(optional — e.g. /explore/experience)</span></Label>
            <Input id="annHref" value={annHref} onChange={(e) => setAnnHref(e.target.value)} placeholder="/explore/experience" className="h-11 rounded-none" />
          </div>
        </div>

        {/* Display currency */}
        <div className="grid gap-2 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Display currency</p>
          <p className="text-xs text-basalt/50">Prices settle in USD; this rate powers the AMD/USD switcher (display only). Set 0 to hide AMD.</p>
          <Label htmlFor="usdToAmd" className="text-sm font-semibold">AMD per 1 USD</Label>
          <Input id="usdToAmd" type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 387" className="h-11 w-48 rounded-none" />
        </div>

        {/* Home "choose the route" section */}
        <div className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Home “choose the route” section</p>
          <div className="grid gap-2">
            <Label htmlFor="catEyebrow" className="text-sm font-semibold">Eyebrow</Label>
            <Input id="catEyebrow" value={catEyebrow} onChange={(e) => setCatEyebrow(e.target.value)} placeholder="Four ways in" className="h-11 rounded-none" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="catTitle" className="text-sm font-semibold">Heading <span className="font-normal text-basalt/45">(line breaks allowed)</span></Label>
            <Textarea id="catTitle" rows={2} value={catTitle} onChange={(e) => setCatTitle(e.target.value)} placeholder={"Let curiosity\nchoose the route."} className="rounded-none text-base" />
          </div>
          {HOME_CATS.map((c) => (
            <div key={c.type} className="grid gap-2 border-t border-basalt/10 pt-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-apricot">{c.name} card</p>
              <Input
                value={homeCats[c.type]?.title ?? ""}
                onChange={(e) => setHomeCats((p) => ({ ...p, [c.type]: { ...(p[c.type] ?? { title: "", label: "" }), title: e.target.value } }))}
                placeholder={c.title}
                className="h-11 rounded-none"
              />
              <Input
                value={homeCats[c.type]?.label ?? ""}
                onChange={(e) => setHomeCats((p) => ({ ...p, [c.type]: { ...(p[c.type] ?? { title: "", label: "" }), label: e.target.value } }))}
                placeholder={c.label}
                className="h-11 rounded-none"
              />
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div>
          <Button onClick={save} disabled={saving || loading} className="rounded-none bg-apricot text-white hover:bg-apricot/90">
            <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save site content"}
          </Button>
        </div>
      </div>
    </section>
  );
}
