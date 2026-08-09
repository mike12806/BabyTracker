import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CssBaseline } from "@mui/material";
import { AppThemeProvider } from "./hooks/useTheme";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ChildProvider } from "./hooks/useChildren";
import { DataRefreshProvider } from "./hooks/useDataRefresh";
import { NotificationProvider } from "./hooks/useNotification";
import { VolumeUnitProvider } from "./hooks/useVolumeUnit";
import Layout from "./components/Layout";
import { Box, CircularProgress } from "@mui/material";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const ChildrenPage = lazy(() => import("./pages/ChildrenPage"));
const FeedingsPage = lazy(() => import("./pages/FeedingsPage"));
const DiapersPage = lazy(() => import("./pages/DiapersPage"));
const SleepPage = lazy(() => import("./pages/SleepPage"));
const TummyTimePage = lazy(() => import("./pages/TummyTimePage"));
const PumpingPage = lazy(() => import("./pages/PumpingPage"));
const GrowthPage = lazy(() => import("./pages/GrowthPage"));
const TemperaturePage = lazy(() => import("./pages/TemperaturePage"));
const NotesPage = lazy(() => import("./pages/NotesPage"));
const TimersPage = lazy(() => import("./pages/TimersPage"));
const MedicationsPage = lazy(() => import("./pages/MedicationsPage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const TodosPage = lazy(() => import("./pages/TodosPage"));
const ChartsPage = lazy(() => import("./pages/ChartsPage"));

const PageFallback = () => (
  <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
    <CircularProgress />
  </Box>
);

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  // If not authenticated, Cloudflare Access will redirect to login
  if (!user) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AppThemeProvider>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <AuthGate>
            {/* DataRefreshProvider wraps ChildProvider so the child list and the
                selected child's own details refetch on the same signal as
                everything else. */}
            <DataRefreshProvider>
              <ChildProvider>
                <NotificationProvider>
                  <VolumeUnitProvider>
                    <Suspense fallback={<PageFallback />}>
                      <Routes>
                        <Route element={<Layout />}>
                          <Route path="/" element={<Dashboard />} />
                          <Route path="/children" element={<ChildrenPage />} />
                          <Route path="/feedings" element={<FeedingsPage />} />
                          <Route path="/diapers" element={<DiapersPage />} />
                          <Route path="/sleep" element={<SleepPage />} />
                          <Route path="/tummy-time" element={<TummyTimePage />} />
                          <Route path="/pumping" element={<PumpingPage />} />
                          <Route path="/growth" element={<GrowthPage />} />
                          <Route path="/temperature" element={<TemperaturePage />} />
                          <Route path="/notes" element={<NotesPage />} />
                          <Route path="/timers" element={<TimersPage />} />
                          <Route path="/medications" element={<MedicationsPage />} />
                          <Route path="/activity" element={<ActivityPage />} />
                          <Route path="/todos" element={<TodosPage />} />
                          <Route path="/charts" element={<ChartsPage />} />
                        </Route>
                      </Routes>
                    </Suspense>
                  </VolumeUnitProvider>
                </NotificationProvider>
              </ChildProvider>
            </DataRefreshProvider>
          </AuthGate>
        </AuthProvider>
      </BrowserRouter>
    </AppThemeProvider>
  );
}
