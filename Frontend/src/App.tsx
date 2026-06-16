import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FirebaseRedirectResume } from "@/components/FirebaseRedirectResume";

// Lazy loaded pages
const LandingPage = lazy(() => import("./pages/LandingPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const DashboardLayout = lazy(() => import("./components/DashboardLayout"));
const NotFound = lazy(() => import("./pages/NotFound"));

// v4 Core Pages
const CommandCenter = lazy(() => import("@/pages/dashboard/CommandCenter"));
const NetworkView = lazy(() => import("@/pages/dashboard/NetworkView"));
const ArView = lazy(() => import("@/pages/dashboard/ArView"));
const Incidents = lazy(() => import("@/pages/dashboard/Incidents"));
const IncidentSimulator = lazy(() => import("@/pages/dashboard/IncidentSimulator"));
const Intelligence = lazy(() => import("@/pages/dashboard/Intelligence"));
const Compliance = lazy(() => import("@/pages/dashboard/Compliance"));
const SettingsPage = lazy(() => import("./pages/dashboard/SettingsPage"));
const RouteViewer = lazy(() => import("@/pages/dashboard/RouteViewer"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Prevent hidden tabs from continuously polling expensive backend endpoints.
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      staleTime: 15 * 60 * 1000,
      retry: 1,
    },
  },
});

// Premium, elegant skeleton loader placeholder matching design variables
const PageLoader = () => (
  <div className="w-full h-screen flex items-center justify-center bg-background/50 backdrop-blur-sm">
    <div className="relative flex items-center justify-center">
      <div className="w-12 h-12 rounded-full border-[3px] border-muted/80 border-t-sentinel animate-spin" />
      <div className="absolute w-6 h-6 rounded-full bg-sentinel/10 animate-pulse-subtle" />
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <FirebaseRedirectResume />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/dashboard" element={<DashboardLayout />}>
              {/* ── v4 Core Routes ── */}
              <Route index element={<CommandCenter />} />
              <Route path="network" element={<NetworkView />} />
              <Route path="ar-view" element={<ArView />} />
              <Route path="incidents" element={<Incidents />} />
              <Route path="incident-simulator" element={<IncidentSimulator />} />
              <Route path="intelligence" element={<Intelligence />} />
              <Route path="compliance" element={<Compliance />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="route-viewer" element={<RouteViewer />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
