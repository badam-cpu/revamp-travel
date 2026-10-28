/** Revamp brandbook: preserve the intact lowercase wordmark, generous clear space, and orange primary action. */
import { useMemo } from "react";
import { Bookmark, CalendarCheck, CalendarDays, Coins, LayoutDashboard, ListChecks, LogOut, Menu, MessageSquare, Settings, ShieldCheck, Sparkles, Store, Ticket, User, UserSearch, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BrandMark } from "./BrandMark";
import { CurrencyMenu, CurrencyToggle } from "./CurrencyToggle";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUnreadMessages } from "@/hooks/useUnreadMessages";
import { useManagedVenue } from "@/hooks/useManagedVenue";
import { useSite } from "@/contexts/SiteContext";

type NavLink = { href: string; label: string; accent?: boolean };

const baseLinks: NavLink[] = [
  { href: "/explore/stay", label: "Stay" },
  { href: "/explore/eat", label: "Eat" },
  { href: "/explore/tour", label: "Tour" },
  { href: "/explore/experience", label: "Experience" },
  { href: "/explore/place", label: "Visit" },
  { href: "/map", label: "Map" },
  { href: "/plan", label: "Plan with Aha AI", accent: true },
];

// revampstay nav. Offer-filtered Rent/Buy pages land with the Explore work;
// for now browse routes to the stay catalog so there are no dead links.
const stayLinks: NavLink[] = [
  { href: "/explore/stay", label: "Homes" },
  { href: "/explore/stay?offer=monthly", label: "Rent" },
  { href: "/explore/stay?offer=sale", label: "Buy" },
  { href: "/map", label: "Map" },
  { href: "/host", label: "List your place" },
];

/** `minimal` drops the public browse nav — used in the
 * operator dashboard, which has its own sidebar and its own "Homepage" link.
 * `flush` swaps the centered container for full-width padding (matching a
 * full-bleed page like the map, so the wordmark lines up with the content).
 * `wide` matches the operator dashboard's wider content wrapper (max-w-1680)
 * so the wordmark lines up with that page's left edge. */
export function SiteHeader({ minimal = false, flush = false, wide = false }: { minimal?: boolean; flush?: boolean; wide?: boolean } = {}) {
  const [location] = useLocation();
  const { user, profile, signOut } = useAuth();
  const unread = useUnreadMessages();
  const hasVenue = useManagedVenue();
  const site = useSite();
  // The support chat signs a shopper in ANONYMOUSLY (a "Guest") so they can ask
  // without an account — that's not a real login, so the header should still
  // show Sign in / Sign up, not the account menu.
  const signedIn = !!user && !((user as { is_anonymous?: boolean }).is_anonymous === true || !user.email);

  const links = useMemo(() => {
    if (minimal) return [];
    const base = site === "stay" ? stayLinks : baseLinks;
    // Dashboard / Admin live in the account menu (2026-10-28), not the browse nav.
    return base;
  }, [profile?.role, minimal, site]);

  const handleSignOut = async () => {
    await signOut();
    toast("Signed out.");
  };

  return (
    <header className="sticky top-[var(--impersonation-bar,0px)] z-50 border-b border-basalt/10 bg-paper/94 text-basalt backdrop-blur-xl">
      <div className={cn("flex h-[76px] items-center justify-between gap-5", wide ? "mx-auto w-full max-w-[1680px] px-4 sm:px-6 lg:px-10" : flush ? "w-full px-5 lg:px-7" : "container")}>
        <BrandMark />
        <nav className="hidden items-center gap-9 xl:flex 2xl:gap-11" aria-label="Primary navigation">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "nav-link relative flex items-center gap-1.5 whitespace-nowrap py-2 text-sm font-semibold tracking-[-0.01em] text-basalt/70 transition-colors hover:text-basalt",
                link.accent && "text-apricot hover:text-apricot",
                location.startsWith(link.href) && (link.accent ? "text-apricot" : "text-basalt"),
              )}
            >
              {link.accent && <Sparkles className="h-3.5 w-3.5" />}
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="hidden shrink-0 items-center gap-1.5 xl:flex">
          <CurrencyMenu />
          {signedIn ? (
            <AccountMenu
              name={profile?.displayName || "Account"}
              role={profile?.role}
              unread={unread}
              hasVenue={hasVenue}
              onSignOut={handleSignOut}
            />
          ) : (
            <>
              {/* One account action (2026-10-27): the sign-in page offers "Create an account". */}
              <Button asChild size="sm" className="h-10 rounded-none bg-basalt px-5 text-sm font-semibold text-paper hover:bg-basalt/90">
                <Link href="/login">Sign in</Link>
              </Button>
            </>
          )}
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-11 w-11 rounded-none xl:hidden" aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[88vw] border-l-0 bg-basalt p-0 text-paper sm:max-w-sm [&>button]:hidden">
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
              <nav className="mt-8 flex min-h-0 flex-1 flex-col overflow-y-auto" aria-label="Mobile navigation">
                {links.map((link, index) => (
                  <SheetClose key={link.href} asChild>
                    <Link href={link.href} className="border-t border-white/15 py-4 font-display text-[2rem] leading-tight tracking-tight">
                      <span className="mr-3 font-sans text-xs text-apricot">0{index + 1}</span>
                      {link.label}
                    </Link>
                  </SheetClose>
                ))}
              </nav>
              <div className="shrink-0 border-t border-white/15 pt-6">
                {signedIn ? (
                  <div className="flex items-center justify-between text-sm text-paper/70">
                    <div className="flex flex-col gap-2">
                      <SheetClose asChild>
                        <Link href="/account?tab=profile" className="inline-flex items-center gap-1.5 font-semibold hover:text-white"><User className="h-3.5 w-3.5" /> {profile?.displayName || "Account"}{unread > 0 && <span className="ml-1 grid h-5 min-w-5 place-items-center rounded-full bg-apricot px-1.5 text-[10px] font-bold text-white">{unread}</span>}</Link>
                      </SheetClose>
                      {profile?.role === "operator" && (
                        <SheetClose asChild>
                          <Link href="/dashboard" className="inline-flex min-h-10 items-center gap-1.5 font-semibold text-paper/70 hover:text-white"><LayoutDashboard className="h-3.5 w-3.5" /> Dashboard</Link>
                        </SheetClose>
                      )}
                      {profile?.role === "admin" && (
                        <SheetClose asChild>
                          <Link href="/admin" className="inline-flex min-h-10 items-center gap-1.5 font-semibold text-paper/70 hover:text-white"><ShieldCheck className="h-3.5 w-3.5" /> Admin</Link>
                        </SheetClose>
                      )}
                      {hasVenue && (
                        <SheetClose asChild>
                          <Link href="/venue" className="font-semibold text-paper/70 hover:text-white">My venue</Link>
                        </SheetClose>
                      )}
                    </div>
                    <SheetClose asChild>
                      <button onClick={handleSignOut} className="inline-flex items-center gap-1.5 font-semibold text-apricot">
                        <LogOut className="h-3.5 w-3.5" /> Sign out
                      </button>
                    </SheetClose>
                  </div>
                ) : (
                  <div className="flex items-center gap-4 text-sm font-semibold">
                    <SheetClose asChild>
                      <Link href="/login" className="text-paper/80 hover:text-white">Sign in</Link>
                    </SheetClose>
                    <SheetClose asChild>
                      <Link href="/signup" className="text-apricot">Sign up</Link>
                    </SheetClose>
                  </div>
                )}
                <div className="mt-5"><CurrencyToggle light /></div>
                <p className="mt-5 text-sm text-paper/60">Stone monasteries, apricot mornings, and the road between.</p>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

/**
 * Signed-in header (2026-10-28): one round account button (the person's
 * initial, an orange dot for unread messages) instead of a bookmark, a name and
 * Sign out side by side. The menu holds Trips, Messages, Saved, Credit,
 * Account, then Dashboard (operators) / Admin (admins) / My venue, and Sign out.
 */
/**
 * Signed-in account menu — one per role, each leading with its own work
 * (user, 2026-10-28: guests, operators and admins get different dropdowns):
 *  - guest: Trips · Messages · Saved · Credit · Account
 *  - operator: Dashboard · Bookings · Calendar · Messages · Settings, then their own Trips/Saved
 *  - admin: Admin · Approvals · Support · Users, then their own Trips/Messages/Saved
 * "My venue" is added for anyone who manages a restaurant.
 */
type MenuLink = { href: string; label: string; icon: typeof User; badge?: number };

function AccountMenu({ name, role, unread, hasVenue, onSignOut }: { name: string; role?: string; unread: number; hasVenue: boolean; onSignOut: () => void }) {
  const initial = (name.trim()[0] || "A").toUpperCase();
  const item = "flex min-h-10 cursor-pointer items-center gap-2.5 text-sm";

  const groups: { title?: string; links: MenuLink[] }[] =
    role === "operator"
      ? [
          {
            title: "Hosting",
            links: [
              { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
              { href: "/dashboard?section=bookings", label: "Bookings", icon: CalendarCheck },
              { href: "/dashboard?section=calendar", label: "Calendar", icon: CalendarDays },
              { href: "/dashboard?section=messages", label: "Messages", icon: MessageSquare, badge: unread },
              { href: "/dashboard?section=settings", label: "Settings", icon: Settings },
            ],
          },
          {
            title: "Travelling",
            links: [
              { href: "/account?tab=trips", label: "Trips", icon: Ticket },
              { href: "/account?tab=saved", label: "Saved", icon: Bookmark },
            ],
          },
        ]
      : role === "admin"
        ? [
            {
              title: "Admin",
              links: [
                { href: "/admin", label: "Overview", icon: ShieldCheck },
                { href: "/admin?section=reviews", label: "Approvals", icon: ListChecks },
                { href: "/admin?section=support", label: "Support", icon: MessageSquare },
                { href: "/admin?section=users", label: "Users", icon: UserSearch },
              ],
            },
            {
              title: "Your account",
              links: [
                { href: "/account?tab=trips", label: "Trips", icon: Ticket },
                { href: "/account?tab=messages", label: "Messages", icon: MessageSquare, badge: unread },
                { href: "/account?tab=saved", label: "Saved", icon: Bookmark },
              ],
            },
          ]
        : [
            {
              links: [
                { href: "/account?tab=trips", label: "Trips", icon: Ticket },
                { href: "/account?tab=messages", label: "Messages", icon: MessageSquare, badge: unread },
                { href: "/account?tab=saved", label: "Saved", icon: Bookmark },
                { href: "/account?tab=credit", label: "Credit", icon: Coins },
                { href: "/account?tab=profile", label: "Account", icon: User },
              ],
            },
          ];
  if (hasVenue) groups.push({ links: [{ href: "/venue", label: "My venue", icon: Store }] });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={unread > 0 ? `Your account — ${unread} unread message${unread === 1 ? "" : "s"}` : "Your account"}
        className="relative ml-1 grid h-10 w-10 place-items-center rounded-full bg-basalt text-sm font-bold text-paper outline-none transition-colors hover:bg-basalt/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot"
      >
        {initial}
        {unread > 0 && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-apricot ring-2 ring-paper" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate py-2 text-sm font-semibold">{name}</DropdownMenuLabel>
        {groups.map((g, gi) => (
          <div key={gi}>
            <DropdownMenuSeparator />
            {g.title && <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/45">{g.title}</p>}
            {g.links.map((l) => (
              <DropdownMenuItem key={l.href} asChild>
                <Link href={l.href} className={item}>
                  <l.icon className="h-4 w-4 text-basalt/55" /> {l.label}
                  {!!l.badge && <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-apricot px-1.5 text-[11px] font-bold text-white">{l.badge}</span>}
                </Link>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut} className={item}><LogOut className="h-4 w-4 text-basalt/55" /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
