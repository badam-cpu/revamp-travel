/** Revamp brandbook: keep routes connected, accessible, and visually consistent with the orange/charcoal/white system. */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { useEffect } from "react";
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
import { SupportWidget } from "./components/SupportWidget";
import { OperatorAssistant } from "./components/OperatorAssistant";
import Home from "./pages/Home";
import Explore from "./pages/Explore";
import Tours from "./pages/Tours";
import EatGuide from "./pages/EatGuide";
import EatLanding from "./pages/EatLanding";
import RegionLanding from "./pages/RegionLanding";
import QrLanding from "./pages/QrLanding";
import MapPage from "./pages/MapPage";
import ListingPage from "./pages/ListingPage";
import Dashboard from "./pages/Dashboard";
import ExperienceOnboarding from "./pages/ExperienceOnboarding";
import AdminReview from "./pages/AdminReview";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ResetPassword from "./pages/ResetPassword";
import Account from "./pages/Account";
import VenueDashboard from "./pages/VenueDashboard";
import Checkout from "./pages/Checkout";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Faq from "./pages/Faq";
import Partners from "./pages/Partners";
import GiftCards from "./pages/GiftCards";
import Region from "./pages/Region";
import Guide from "./pages/Guide";
import Events from "./pages/Events";
import Host from "./pages/Host";
import RedeemStation from "./pages/RedeemStation";
import TripPage from "./pages/TripPage";
import InvoicePage from "./pages/InvoicePage";
import Plan from "./pages/Plan";
import Developers from "./pages/Developers";
import StayHome from "./pages/StayHome";
import { SiteProvider, useSite } from "@/contexts/SiteContext";

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
  return (
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
                    <SupportWidget />
                    <OperatorAssistant />
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
