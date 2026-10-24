/**
 * "Make a banner" for campaign emails: headline + brand theme → a 1200 × 600
 * banner drawn in the browser (client/src/lib/bannerMaker.ts), saved to the
 * campaign image library through the normal upload path (JPEG, ≤300 KB), and
 * selected for the campaign with the banner's words as its alt text.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { uploadCampaignImage, type CampaignImage } from "@/lib/campaignImage";
import {
  BANNER_H,
  BANNER_PATTERNS,
  BANNER_THEMES,
  BANNER_W,
  DEFAULT_BANNER,
  EYEBROW_MAX,
  HEADLINE_MAX,
  SUBLINE_MAX,
  bannerAlt,
  drawBanner,
  loadBannerFonts,
  type BannerSpec,
} from "@/lib/bannerMaker";

const FIELD = "h-12 w-full rounded-none border border-basalt/15 bg-paper px-3 text-base outline-none focus:border-basalt sm:h-10 sm:text-sm";

export function BannerMaker({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (img: CampaignImage, alt: string) => void }) {
  const { user } = useAuth();
  const [spec, setSpec] = useState<BannerSpec>(DEFAULT_BANNER);
  const [fontsReady, setFontsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const set = <K extends keyof BannerSpec>(k: K, v: BannerSpec[K]) => setSpec((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (open) void loadBannerFonts().then(() => setFontsReady(true));
  }, [open]);
  // Redraw on every change (cheap: one 1200 × 600 canvas).
  useEffect(() => {
    if (open && canvasRef.current) drawBanner(canvasRef.current, spec);
  }, [open, spec, fontsReady]);

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !user || !spec.headline.trim()) return;
    setSaving(true);
    try {
      drawBanner(canvas, spec);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("Couldn't create the banner in this browser.");
      const name = `Banner — ${spec.headline.replace(/\s+/g, " ").trim()}`.slice(0, 80);
      const img = await uploadCampaignImage(new File([blob], `${name}.png`, { type: "image/png" }), user.id);
      onCreated(img, bannerAlt(spec));
      toast.success("Banner saved to your library and added to the campaign.");
      onOpenChange(false);
      setSpec(DEFAULT_BANNER);
    } catch (e) {
      console.error("[banner maker]", e);
      toast(e instanceof Error ? e.message : "Couldn't save the banner — try again.");
    } finally {
      setSaving(false);
    }
  };

  const chip = (on: boolean) =>
    cn("h-10 rounded-full border px-3.5 text-sm font-semibold transition-colors", on ? "border-basalt bg-basalt text-paper" : "border-basalt/15 bg-paper text-basalt/70 hover:border-basalt/40");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] gap-0 overflow-y-auto rounded-none p-0 sm:max-w-3xl">
        <div className="border-b border-basalt/10 px-5 py-4 pr-14">
          <DialogTitle className="text-lg font-semibold">Make a banner</DialogTitle>
          <DialogDescription className="mt-0.5 text-sm text-basalt/60">A 1200 × 600 brand banner for this email. It's saved to your image library.</DialogDescription>
        </div>

        <div className="grid gap-5 p-5">
          {/* Live preview (drawn at full size, shown scaled) */}
          <canvas ref={canvasRef} width={BANNER_W} height={BANNER_H} role="img" aria-label={`Banner preview: ${bannerAlt(spec) || "empty"}`} className="block aspect-[2/1] w-full border border-basalt/10" />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="bn-headline" className="text-xs font-semibold">Headline</Label>
              <textarea
                id="bn-headline"
                value={spec.headline}
                onChange={(e) => set("headline", e.target.value.slice(0, HEADLINE_MAX))}
                rows={2}
                maxLength={HEADLINE_MAX}
                placeholder={"Autumn in Dilijan\n20% off forest stays"}
                className="w-full resize-none rounded-none border border-basalt/15 bg-paper px-3 py-2.5 text-base font-semibold outline-none focus:border-basalt sm:text-sm"
              />
              <p className="flex justify-between gap-3 text-xs text-basalt/55">
                <span>Up to 3 lines — press Enter to choose where a line breaks. The size adjusts to fit.</span>
                <span className="shrink-0 tabular-nums">{spec.headline.length}/{HEADLINE_MAX}</span>
              </p>
              <label className="mt-1 flex min-h-10 items-center gap-2.5 text-sm">
                <input type="checkbox" checked={spec.accentLastLine} onChange={(e) => set("accentLastLine", e.target.checked)} className="h-5 w-5 accent-[#F15822]" />
                Last line in {spec.theme === "orange" ? "charcoal" : "orange"}
              </label>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bn-eyebrow" className="text-xs font-semibold">Small line above <span className="font-normal text-basalt/45">(optional)</span></Label>
              <input id="bn-eyebrow" value={spec.eyebrow} onChange={(e) => set("eyebrow", e.target.value)} maxLength={EYEBROW_MAX} placeholder="New on Revamp" className={FIELD} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bn-subline" className="text-xs font-semibold">Line below <span className="font-normal text-basalt/45">(optional)</span></Label>
              <input id="bn-subline" value={spec.subline} onChange={(e) => set("subline", e.target.value)} maxLength={SUBLINE_MAX} placeholder="Book by 30 November" className={FIELD} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <p className="text-xs font-semibold">Background</p>
              <div className="flex flex-wrap gap-1.5">
                {BANNER_THEMES.map((t) => (
                  <button key={t.value} type="button" aria-pressed={spec.theme === t.value} onClick={() => set("theme", t.value)} className={cn(chip(spec.theme === t.value), "inline-flex items-center gap-2")}>
                    <span aria-hidden className="h-4 w-4 rounded-full border border-basalt/20" style={{ background: t.swatch }} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <p className="text-xs font-semibold">Pattern</p>
              <div className="flex flex-wrap gap-1.5">
                {BANNER_PATTERNS.map((p) => (
                  <button key={p.value} type="button" aria-pressed={spec.pattern === p.value} onClick={() => set("pattern", p.value)} className={chip(spec.pattern === p.value)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label className="flex min-h-10 items-center gap-2.5 text-sm">
            <input type="checkbox" checked={spec.showSite} onChange={(e) => set("showSite", e.target.checked)} className="h-5 w-5 accent-[#F15822]" />
            Show “revampvacations.com · Armenia” at the bottom
          </label>
          <p className="bg-chalk/60 p-3 text-xs leading-5 text-basalt/70">
            The banner's words become its alt text, because many inboxes hide images until the reader allows them. Say the important part in the message too.
          </p>
        </div>

        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-basalt/10 bg-paper px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => onOpenChange(false)} className="h-11 px-4 text-sm font-semibold text-basalt/70 hover:text-basalt">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving || !spec.headline.trim() || !user} className="inline-flex h-11 items-center gap-2 rounded-none bg-apricot px-5 text-sm font-semibold text-white hover:bg-apricot/90 disabled:opacity-40">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Saving…" : "Save to library & use"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
