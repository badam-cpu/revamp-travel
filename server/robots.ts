/**
 * Dynamic GET /robots.txt — not a static client/public/ file, so the
 * Sitemap: line can point at this deployment's own origin (whatever
 * domain it's actually running under) with no env var to configure.
 * Lists every entry in server/botDetect.ts's KNOWN_BOTS explicitly, so the
 * published policy and the prerender middleware's UA sniffing can never
 * drift apart — see that file's header comment.
 */
import type { Request, Response } from "express";
import { KNOWN_BOTS } from "./botDetect.js";

export function robotsTxtHandler(req: Request, res: Response): void {
  const origin = `${req.protocol}://${req.get("host")}`;

  const lines: string[] = [];
  lines.push("User-agent: *");
  lines.push("Allow: /");
  lines.push("Disallow: /dashboard");
  lines.push("Disallow: /admin");
  lines.push("");

  for (const bot of KNOWN_BOTS) {
    lines.push(`User-agent: ${bot.name}`);
    lines.push("Allow: /");
    lines.push("Disallow: /dashboard");
    lines.push("Disallow: /admin");
    lines.push("");
  }

  lines.push(`Sitemap: ${origin}/sitemap.xml`);

  res.type("text/plain").send(lines.join("\n"));
}
