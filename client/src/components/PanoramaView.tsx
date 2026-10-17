/**
 * A 360° photo you can drag (or swipe) to look around in — Photo Sphere Viewer
 * (MIT, three.js). This module is only ever loaded lazily by VirtualTour, so
 * three.js stays out of every other page's bundle. If WebGL isn't available
 * the flat photo is shown instead.
 */
import { useEffect, useRef, useState } from "react";
import "@photo-sphere-viewer/core/index.css";

export default function PanoramaView({ url, label }: { url: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let viewer: { destroy(): void } | null = null;
    let cancelled = false;
    setFailed(false);
    import("@photo-sphere-viewer/core")
      .then(({ Viewer }) => {
        if (cancelled || !ref.current) return;
        try {
          viewer = new Viewer({
            container: ref.current,
            panorama: url,
            navbar: false,
            loadingTxt: "",
            defaultZoomLvl: 0,
            mousewheelCtrlKey: true, // don't hijack page scrolling
            touchmoveTwoFingers: false,
            keyboard: false,
          });
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
      viewer?.destroy();
    };
  }, [url]);

  if (failed) return <img src={url} alt={label} className="h-full w-full object-contain" />;
  return <div ref={ref} role="img" aria-label={`${label} — 360° view, drag to look around`} className="h-full w-full" />;
}
