import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CssBaseline } from "@mui/material";
import { AppThemeProvider } from "./hooks/useTheme";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ChildProvider } from "./hooks/useChildren";
import { NotificationProvider } from "./hooks/useNotification";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import ChildrenPage from "./pages/ChildrenPage";
import FeedingsPage from "./pages/FeedingsPage";
import DiapersPage from "./pages/DiapersPage";
import SleepPage from "./pages/SleepPage";
import TummyTimePage from "./pages/TummyTimePage";
import PumpingPage from "./pages/PumpingPage";
import GrowthPage from "./pages/GrowthPage";
import TemperaturePage from "./pages/TemperaturePage";
import NotesPage from "./pages/NotesPage";
import TimersPage from "./pages/TimersPage";
import { Box, CircularProgress } from "@mui/material";

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
            <ChildProvider>
              <NotificationProvider>
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
                  </Route>
                </Routes>
              </NotificationProvider>
            </ChildProvider>
          </AuthGate>
        </AuthProvider>
      </BrowserRouter>
    </AppThemeProvider>
  );
}
