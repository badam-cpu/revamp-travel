/** Revamp brandbook: preserve the intact lowercase wordmark, generous clear space, and orange primary action. */
import { Bookmark, Compass, Menu, Sparkles, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BrandMark } from "./BrandMark";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const links = [
  { href: "/explore/stay", label: "Stay" },
  { href: "/explore/eat", label: "Eat" },
  { href: "/explore/tour", label: "Tours" },
  { href: "/map", label: "Map" },
  { href: "/plan", label: "AI Planner", accent: true },
  { href: "/manage", label: "Manage" },
];

export function SiteHeader() {
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 border-b border-basalt/10 bg-paper/94 text-basalt backdrop-blur-xl">
      <div className="container flex h-[76px] items-center justify-between">
        <BrandMark />
        <nav className="hidden items-center gap-8 lg:flex" aria-label="Primary navigation">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "nav-link relative flex items-center gap-1.5 py-2 text-sm font-semibold tracking-[-0.01em] text-basalt/70 transition-colors hover:text-basalt",
                link.accent && "text-apricot hover:text-apricot",
                location.startsWith(link.href) && (link.accent ? "text-apricot" : "text-basalt"),
              )}
            >
              {link.accent && <Sparkles className="h-3.5 w-3.5" />}
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-none text-basalt hover:bg-tuff/10"
            onClick={() => toast("Your saved places will appear here.")}
            aria-label="Saved places"
          >
            <Bookmark className="h-4 w-4" />
          </Button>
          <Button asChild className="brand-notch rounded-none bg-apricot px-5 text-white hover:bg-apricot/90">
            <Link href="/explore">
              <Compass className="mr-2 h-4 w-4" /> Open the field guide
            </Link>
          </Button>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-none lg:hidden" aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[88vw] border-l-0 bg-basalt p-0 text-paper sm:max-w-sm">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Browse Revamp travel categories and the Armenia map.</SheetDescription>
            <div className="flex h-full flex-col p-7">
              <div className="flex items-center justify-between">
                <BrandMark light />
                <SheetClose asChild>
                  <Button variant="ghost" size="icon" className="rounded-none text-paper hover:bg-white/10 hover:text-white">
                    <X className="h-5 w-5" />
                  </Button>
                </SheetClose>
              </div>
              <nav className="mt-16 flex flex-col" aria-label="Mobile navigation">
                {links.map((link, index) => (
                  <SheetClose key={link.href} asChild>
                    <Link href={link.href} className="border-t border-white/15 py-5 font-display text-4xl tracking-tight">
                      <span className="mr-3 font-sans text-xs text-apricot">0{index + 1}</span>
                      {link.label}
                    </Link>
                  </SheetClose>
                ))}
              </nav>
              <div className="mt-auto border-t border-white/15 pt-6 text-sm text-paper/60">
                Stone monasteries, apricot mornings, and the road between.
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
