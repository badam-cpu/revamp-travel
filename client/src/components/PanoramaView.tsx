/**
 * A 360° photo you can drag (or swipe) to look around in — Photo Sphere Viewer
 * (MIT, three.js). This module is only ever loaded lazily by VirtualTour, so
 * three.js stays out of every other page's bundle. If WebGL isn't available
 * the flat photo is shown instead.
 *
 * `autoRotate`: turns slowly (a full circle in about a minute) while the tour
 * plays; the first drag, scroll or tap stops it and calls `onInteract`.
 */
import { useEffect, useRef, useState } from "react";
import "@photo-sphere-viewer/core/index.css";

const TURN_PER_SECOND = (2 * Math.PI) / 60;

interface ViewerLike {
  destroy(): void;
  getPosition(): { yaw: number; pitch: number };
  rotate(p: { yaw: number; pitch: number }): void;
  addEventListener(type: string, cb: () => void, opts?: { once?: boolean }): void;
}

export default function PanoramaView({ url, label, autoRotate = false, onInteract }: { url: string; label: string; autoRotate?: boolean; onInteract?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ViewerLike | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const interactRef = useRef(onInteract);
  interactRef.current = onInteract;

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setReady(false);
    import("@photo-sphere-viewer/core")
      .then(({ Viewer }) => {
        if (cancelled || !ref.current) return;
        try {
          const v = new Viewer({
            container: ref.current,
            panorama: url,
            navbar: false,
            loadingTxt: "",
            defaultZoomLvl: 0,
            mousewheelCtrlKey: true, // don't hijack page scrolling
            touchmoveTwoFingers: false,
            keyboard: false,
          }) as unknown as ViewerLike;
          viewerRef.current = v;
          v.addEventListener("ready", () => !cancelled && setReady(true), { once: true });
        } catch (e) {
          console.error("[panorama] viewer", e);
          setFailed(true);
        }
      })
      .catch((e) => {
        console.error("[panorama] load", e);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [url]);

  // Slow turn while the tour plays.
  useEffect(() => {
    const v = viewerRef.current;
    const el = ref.current;
    if (!autoRotate || !ready || !v || !el) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const p = v.getPosition();
      v.rotate({ yaw: p.yaw + TURN_PER_SECOND * dt, pitch: p.pitch });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const stop = () => {
      cancelAnimationFrame(raf);
      interactRef.current?.();
    };
    const opts = { once: true, passive: true } as const;
    el.addEventListener("pointerdown", stop, opts);
    el.addEventListener("wheel", stop, opts);
    el.addEventListener("touchstart", stop, opts);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", stop);
      el.removeEventListener("wheel", stop);
      el.removeEventListener("touchstart", stop);
    };
  }, [autoRotate, ready]);

  if (failed) return <img src={url} alt={label} className="h-full w-full object-contain" />;
  return <div ref={ref} role="img" aria-label={`${label} — 360° view, drag to look around`} className="h-full w-full" />;
}
