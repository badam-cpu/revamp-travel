/** Revamp brandbook: keep routes connected, accessible, and visually consistent with the orange/charcoal/white system. */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import { ListingsProvider } from "./contexts/ListingsContext";
import { SavedPlacesProvider } from "./contexts/SavedPlacesContext";
import { SiteSettingsProvider } from "./contexts/SiteSettingsContext";
import { AnnouncementBanner } from "./components/AnnouncementBanner";
import { SupportWidget } from "./components/SupportWidget";
import Home from "./pages/Home";
import Explore from "./pages/Explore";
import Tours from "./pages/Tours";
import MapPage from "./pages/MapPage";
import ListingPage from "./pages/ListingPage";
import Dashboard from "./pages/Dashboard";
import ExperienceOnboarding from "./pages/ExperienceOnboarding";
import AdminReview from "./pages/AdminReview";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ResetPassword from "./pages/ResetPassword";
import Account from "./pages/Account";
import Plan from "./pages/Plan";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/explore/tour" component={Tours} />
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
                <TooltipProvider>
                  <Toaster />
                  <AnnouncementBanner />
                  <Router />
                  <SupportWidget />
                </TooltipProvider>
              </SiteSettingsProvider>
            </SavedPlacesProvider>
          </ListingsProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
