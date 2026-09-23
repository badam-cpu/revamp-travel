/** Revamp brandbook: keep routes connected, accessible, and visually consistent with the orange/charcoal/white system. */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { useEffect } from "react";
import { initAnalytics, trackPageView } from "./lib/analytics";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import { ListingsProvider } from "./contexts/ListingsContext";
import { SavedPlacesProvider } from "./contexts/SavedPlacesContext";
import { SiteSettingsProvider } from "./contexts/SiteSettingsContext";
import { CurrencyProvider } from "./contexts/CurrencyContext";
import { AnnouncementBanner } from "./components/AnnouncementBanner";
import { SupportWidget } from "./components/SupportWidget";
import { OperatorAssistant } from "./components/OperatorAssistant";
import Home from "./pages/Home";
import Explore from "./pages/Explore";
import Tours from "./pages/Tours";
import EatGuide from "./pages/EatGuide";
import MapPage from "./pages/MapPage";
import ListingPage from "./pages/ListingPage";
import Dashboard from "./pages/Dashboard";
import ExperienceOnboarding from "./pages/ExperienceOnboarding";
import AdminReview from "./pages/AdminReview";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ResetPassword from "./pages/ResetPassword";
import Account from "./pages/Account";
import Checkout from "./pages/Checkout";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Faq from "./pages/Faq";
import Partners from "./pages/Partners";
import GiftCards from "./pages/GiftCards";
import Region from "./pages/Region";
import Plan from "./pages/Plan";

/** Loads GA4 (if configured) and reports a page view on every route change. */
function AnalyticsTracker() {
  const [location] = useLocation();
  useEffect(() => {
    initAnalytics();
  }, []);
  useEffect(() => {
    // Defer so the per-page <title> (set by useDocumentMeta) is current.
    const t = setTimeout(() => trackPageView(location), 0);
    return () => clearTimeout(t);
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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/explore/tour" component={Tours} />
      <Route path="/explore/eat" component={EatGuide} />
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
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/faq" component={Faq} />
      <Route path="/partners" component={Partners} />
      <Route path="/gift-cards" component={GiftCards} />
      <Route path="/region/:slug">{(params) => <Region slug={params.slug} />}</Route>
      <Route path="/blog" component={Blog} />
      <Route path="/blog/:slug">{(params) => <BlogPost params={params} />}</Route>
      <Route path="/checkout/:slug">{(params) => <Checkout slug={params.slug} />}</Route>
      <Route path="/listing/:slug">{(params) => <ListingPage params={params} />}</Route>
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
          <ListingsProvider>
            <SavedPlacesProvider>
              <SiteSettingsProvider>
                <CurrencyProvider>
                  <TooltipProvider>
                    <Toaster />
                    <AnalyticsTracker />
                    <ScrollToTop />
                    <AnnouncementBanner />
                    <Router />
                    <SupportWidget />
                    <OperatorAssistant />
                  </TooltipProvider>
                </CurrencyProvider>
              </SiteSettingsProvider>
            </SavedPlacesProvider>
          </ListingsProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
