/** Revamp brandbook: keep routes connected, accessible, and visually consistent with the orange/charcoal/white system. */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { Suspense, lazy, useEffect } from "react";
import { DEFAULT_TITLE, initAnalytics, isPrivatePath, setInternalTraffic, trackPageView } from "./lib/analytics";
import { storeReferralCode } from "./lib/referrals";
import { isTeamDevice } from "./lib/track";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ListingsProvider } from "./contexts/ListingsContext";
import { SavedPlacesProvider } from "./contexts/SavedPlacesContext";
import { SiteSettingsProvider } from "./contexts/SiteSettingsContext";
import { CurrencyProvider } from "./contexts/CurrencyContext";
import { AnnouncementBanner } from "./components/AnnouncementBanner";
import { ImpersonationBar } from "./components/ImpersonationBar";
import { CookieConsent } from "./components/CookieConsent";
import { SiteHeader } from "./components/SiteHeader";
// Loaded on demand: the support chat (guests) and the Aha assistant (operators)
// aren't needed to show the first page.
const SupportWidget = lazy(() => import("./components/SupportWidget").then((m) => ({ default: m.SupportWidget })));
const OperatorAssistant = lazy(() => import("./components/OperatorAssistant").then((m) => ({ default: m.OperatorAssistant })));
import Home from "./pages/Home";
const Explore = lazy(() => import("./pages/Explore"));
const Tours = lazy(() => import("./pages/Tours"));
const EatGuide = lazy(() => import("./pages/EatGuide"));
const EatLanding = lazy(() => import("./pages/EatLanding"));
const RegionLanding = lazy(() => import("./pages/RegionLanding"));
const QrLanding = lazy(() => import("./pages/QrLanding"));
const MapPage = lazy(() => import("./pages/MapPage"));
const ListingPage = lazy(() => import("./pages/ListingPage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ExperienceOnboarding = lazy(() => import("./pages/ExperienceOnboarding"));
const AdminReview = lazy(() => import("./pages/AdminReview"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const Account = lazy(() => import("./pages/Account"));
const VenueDashboard = lazy(() => import("./pages/VenueDashboard"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogPost = lazy(() => import("./pages/BlogPost"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const Faq = lazy(() => import("./pages/Faq"));
const Partners = lazy(() => import("./pages/Partners"));
const GiftCards = lazy(() => import("./pages/GiftCards"));
const Region = lazy(() => import("./pages/Region"));
const Guide = lazy(() => import("./pages/Guide"));
const Events = lazy(() => import("./pages/Events"));
const Host = lazy(() => import("./pages/Host"));
const RedeemStation = lazy(() => import("./pages/RedeemStation"));
const TripPage = lazy(() => import("./pages/TripPage"));
const InvoicePage = lazy(() => import("./pages/InvoicePage"));
const Plan = lazy(() => import("./pages/Plan"));
const Developers = lazy(() => import("./pages/Developers"));
const StayHome = lazy(() => import("./pages/StayHome"));
import { SiteProvider, useSite } from "@/contexts/SiteContext";

/*
 * Code splitting: every page except the home page loads on demand
 * (React.lazy), so a guest opening one listing no longer downloads the
 * operator dashboard, admin and campaign tools. Bots are unaffected (they get
 * server-rendered HTML from server/prerender.ts). A tab left open across a
 * deploy can ask for a chunk that no longer exists — main.tsx reloads once
 * on Vite's "vite:preloadError".
 */

/** While a page's code loads: the site header over a blank page, so a first
 * visit to a page doesn't flash white. */
function PageFallback() {
  return (
    <div className="min-h-screen bg-paper" aria-busy="true">
      <SiteHeader />
    </div>
  );
}

/** The Aha assistant is operator-only — guests never download its code. */
function OperatorAssistantGate() {
  const { profile } = useAuth();
  return profile?.role === "operator" ? <OperatorAssistant /> : null;
}

/** Warm the pages guests most often open next, once the browser is idle. */
function usePrefetchCommonPages() {
  useEffect(() => {
    const go = () => {
      void import("./pages/ListingPage");
      void import("./pages/Explore");
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const t = window.setTimeout(() => (w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 4000 }) : go()), 2500);
    return () => window.clearTimeout(t);
  }, []);
}

/** The "/" landing: revampstay gets StayHome, revampvacations keeps Home. */
function SiteHome() {
  return useSite() === "stay" ? <StayHome /> : <Home />;
}

/**
 * Loads GA4 (if configured) and reports a page view on every route change —
 * once the page has set its own <title> (route components load lazily, so an
 * immediate report would be filed under the site's default title), or after
 * 1.5 s, or when the visitor moves on. Private pages are skipped inside
 * trackPageView; signed-in operators/admins are tagged as internal traffic.
 */
function AnalyticsTracker() {
  const [location] = useLocation();
  const { profile } = useAuth();
  useEffect(() => {
    initAnalytics();
  }, []);
  useEffect(() => {
    setInternalTraffic(profile?.role === "admin" || profile?.role === "operator" || isTeamDevice());
  }, [profile?.role]);
  useEffect(() => {
    if (isPrivatePath(location)) return;
    const before = document.title;
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      obs.disconnect();
      clearTimeout(timer);
      trackPageView(location);
    };
    const obs = new MutationObserver(() => {
      if (document.title !== before && document.title !== DEFAULT_TITLE) send();
    });
    obs.observe(document.head, { subtree: true, childList: true, characterData: true });
    const timer = setTimeout(send, 1500);
    return send; // leaving quickly still counts the view
  }, [location]);
  return null;
}

/** Resets scroll to the top on every path change so a freshly opened page
 *  (e.g. a listing) always starts at its header, not wherever the previous
 *  page was scrolled. useLocation() tracks the pathname only, so query-string
 *  changes (Explore filters, ?tab= on /account) don't jump the page. */
function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

/** /r/:code — a host's referral link. Stashes the code, then sends the visitor
 *  to signup (operator pre-selected) so attribution survives the account flow. */
function ReferralCapture({ code }: { code: string }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    storeReferralCode(code);
    navigate(`/signup?ref=${encodeURIComponent(code)}`, { replace: true });
  }, [code, navigate]);
  return null;
}

function Router() {
  usePrefetchCommonPages();
  return (
    <Suspense fallback={<PageFallback />}>
    <Switch>
      <Route path="/" component={SiteHome} />
      <Route path="/r/:code">{(params) => <ReferralCapture code={params.code} />}</Route>
      <Route path="/explore/tour" component={Tours} />
      <Route path="/explore/eat" component={EatGuide} />
      <Route path="/eat/cuisine/:cuisine">{(params) => <EatLanding mode="cuisine" value={params.cuisine} />}</Route>
      <Route path="/eat/:region">{(params) => <EatLanding mode="region" value={params.region} />}</Route>
      <Route path="/stay/:region">{(params) => <RegionLanding type="stay" region={params.region} />}</Route>
      <Route path="/tour/:region">{(params) => <RegionLanding type="tour" region={params.region} />}</Route>
      <Route path="/experience/:region">{(params) => <RegionLanding type="experience" region={params.region} />}</Route>
      <Route path="/visit/:region">{(params) => <RegionLanding type="place" region={params.region} />}</Route>
      <Route path="/explore/:category">{(params) => <Explore initialType={params.category} />}</Route>
      <Route path="/explore">{() => <Explore />}</Route>
      <Route path="/map" component={MapPage} />
      <Route path="/plan" component={Plan} />
      <Route path="/dashboard/experiences/new" component={ExperienceOnboarding} />
      <Route path="/dashboard/experiences/:id/edit">{(params) => <ExperienceOnboarding params={params} />}</Route>
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/admin" component={AdminReview} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/account" component={Account} />
      <Route path="/venue" component={VenueDashboard} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/faq" component={Faq} />
      <Route path="/developers" component={Developers} />
      <Route path="/partners" component={Partners} />
      <Route path="/gift-cards" component={GiftCards} />
      <Route path="/region/:slug">{(params) => <Region slug={params.slug} />}</Route>
      <Route path="/events" component={Events} />
      <Route path="/guide">{() => <Guide />}</Route>
      <Route path="/guide/:slug">{(params) => <Guide slug={params.slug} />}</Route>
      <Route path="/host">{() => <Host />}</Route>
      <Route path="/host/:type">{(params) => <Host type={params.type} />}</Route>
      <Route path="/blog" component={Blog} />
      <Route path="/blog/:slug">{(params) => <BlogPost params={params} />}</Route>
      <Route path="/checkout/:slug">{(params) => <Checkout slug={params.slug} />}</Route>
      <Route path="/listing/:slug">{(params) => <ListingPage params={params} />}</Route>
      <Route path="/redeem/:token">{(params) => <RedeemStation token={params.token} />}</Route>
      <Route path="/trip/:token">{(params) => <TripPage token={params.token} />}</Route>
      <Route path="/invoice/:token">{(params) => <InvoicePage token={params.token} />}</Route>
      <Route path="/q/:code">{(params) => <QrLanding code={params.code} />}</Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <AuthProvider>
          <SiteProvider>
          <ListingsProvider>
            <SavedPlacesProvider>
              <SiteSettingsProvider>
                <CurrencyProvider>
                  <TooltipProvider>
                    <Toaster />
                    <AnalyticsTracker />
                    <ScrollToTop />
                    <AnnouncementBanner />
                    <ImpersonationBar />
                    <Router />
                    <Suspense fallback={null}>
                      <SupportWidget />
                      <OperatorAssistantGate />
                    </Suspense>
                    <CookieConsent />
                  </TooltipProvider>
                </CurrencyProvider>
              </SiteSettingsProvider>
            </SavedPlacesProvider>
          </ListingsProvider>
          </SiteProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
