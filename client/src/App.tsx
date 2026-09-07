/** Revamp brandbook: keep routes connected, accessible, and visually consistent with the orange/charcoal/white system. */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ListingsProvider } from "./contexts/ListingsContext";
import Home from "./pages/Home";
import Explore from "./pages/Explore";
import MapPage from "./pages/MapPage";
import ListingPage from "./pages/ListingPage";
import Manage from "./pages/Manage";
import Plan from "./pages/Plan";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/explore/:category">{(params) => <Explore initialType={params.category} />}</Route>
      <Route path="/explore">{() => <Explore />}</Route>
      <Route path="/map" component={MapPage} />
      <Route path="/plan" component={Plan} />
      <Route path="/manage" component={Manage} />
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
        <ListingsProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </ListingsProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
