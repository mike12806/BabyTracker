import { useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  AppBar,
  Avatar,
  Box,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  SwipeableDrawer,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import DashboardIcon from "@mui/icons-material/Dashboard";
import RestaurantIcon from "@mui/icons-material/Restaurant";
import BabyChangingStationIcon from "@mui/icons-material/BabyChangingStation";
import BedtimeIcon from "@mui/icons-material/Bedtime";
import AccessibilityNewIcon from "@mui/icons-material/AccessibilityNew";
import OpacityIcon from "@mui/icons-material/Opacity";
import MonitorWeightIcon from "@mui/icons-material/MonitorWeight";
import ThermostatIcon from "@mui/icons-material/Thermostat";
import NoteIcon from "@mui/icons-material/Note";
import TimerIcon from "@mui/icons-material/Timer";
import ChildCareIcon from "@mui/icons-material/ChildCare";
import MedicationIcon from "@mui/icons-material/Medication";
import HistoryIcon from "@mui/icons-material/History";
import ChecklistIcon from "@mui/icons-material/Checklist";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import SettingsBrightnessIcon from "@mui/icons-material/SettingsBrightness";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import BarChartRoundedIcon from "@mui/icons-material/BarChartRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import { useAuth } from "../hooks/useAuth";
import { useChildren } from "../hooks/useChildren";
import { useThemeMode } from "../hooks/useTheme";
import { API_BASE } from "../api/client";
import QuickLogDialog, { type QuickLogCategory } from "./QuickLogDialog";

const DRAWER_WIDTH = 240;
const BOTTOM_NAV_HEIGHT = 68;
export const FAB_BOTTOM_OFFSET = `calc(${BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom) + 16px)`;

const navItems = [
  { label: "Dashboard", icon: <DashboardIcon />, path: "/" },
  { label: "Feedings", icon: <RestaurantIcon />, path: "/feedings" },
  { label: "Diapers", icon: <BabyChangingStationIcon />, path: "/diapers" },
  { label: "Sleep", icon: <BedtimeIcon />, path: "/sleep" },
  { label: "Tummy Time", icon: <AccessibilityNewIcon />, path: "/tummy-time" },
  { label: "Pumping", icon: <OpacityIcon />, path: "/pumping" },
  { label: "Growth", icon: <MonitorWeightIcon />, path: "/growth" },
  { label: "Temperature", icon: <ThermostatIcon />, path: "/temperature" },
  { label: "Medications", icon: <MedicationIcon />, path: "/medications" },
  { label: "To-Do", icon: <ChecklistIcon />, path: "/todos" },
  { label: "Notes", icon: <NoteIcon />, path: "/notes" },
  { label: "Timers", icon: <TimerIcon />, path: "/timers" },
  { label: "Activity", icon: <HistoryIcon />, path: "/activity" },
  { label: "Children", icon: <ChildCareIcon />, path: "/children" },
];

const bottomNavTabs = [
  { id: "home", label: "Home", icon: <HomeRoundedIcon />, path: "/" },
  { id: "activity", label: "Activity", icon: <TimelineRoundedIcon />, path: "/activity" },
  { id: "log", label: "Log", icon: <AddRoundedIcon sx={{ fontSize: 28 }} />, path: null, isFab: true },
  { id: "charts", label: "Charts", icon: <BarChartRoundedIcon />, path: "/charts" },
  { id: "more", label: "More", icon: <MoreHorizRoundedIcon />, path: null, isMore: true },
];

export default function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [quickLogCategory, setQuickLogCategory] = useState<QuickLogCategory | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { children, selectedChild, selectChild } = useChildren();
  const { preference, setPreference } = useThemeMode();
  const muiTheme = useTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down("md"));
  const isDark = muiTheme.palette.mode === "dark";

  const cycleTheme = () => {
    const order: Array<"system" | "light" | "dark"> = ["system", "light", "dark"];
    const next = order[(order.indexOf(preference) + 1) % order.length];
    setPreference(next);
  };

  const themeIcon = preference === "system"
    ? <SettingsBrightnessIcon />
    : preference === "dark"
      ? <LightModeIcon />
      : <DarkModeIcon />;

  const themeLabel = preference === "system"
    ? "Theme: System"
    : preference === "dark"
      ? "Theme: Dark"
      : "Theme: Light";

  const activeTab = (() => {
    if (location.pathname === "/") return "home";
    if (location.pathname === "/activity") return "activity";
    if (location.pathname === "/charts") return "charts";
    return "more";
  })();

  const handleBottomNav = (tab: typeof bottomNavTabs[number]) => {
    if (tab.isFab) {
      setAddSheetOpen(!addSheetOpen);
      return;
    }
    if (tab.isMore) {
      setDrawerOpen(true);
      return;
    }
    if (tab.path) navigate(tab.path);
  };

  const addSheetItems: { label: string; icon: React.ReactNode; cat: QuickLogCategory }[] = [
    { label: "Feeding", icon: <RestaurantIcon />, cat: "feed" },
    { label: "Diaper", icon: <BabyChangingStationIcon />, cat: "diaper" },
    { label: "Sleep", icon: <BedtimeIcon />, cat: "sleep" },
    { label: "Pumping", icon: <OpacityIcon />, cat: "pump" },
    { label: "Tummy Time", icon: <AccessibilityNewIcon />, cat: "tummy" },
    { label: "Note", icon: <NoteIcon />, cat: "note" },
  ];

  const drawer = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar />
      {children.length > 1 && (
        <Box sx={{ px: 2, py: 1.5 }}>
          <Select
            fullWidth
            size="small"
            value={selectedChild?.id || ""}
            onChange={(e) => {
              const child = children.find((c) => c.id === e.target.value);
              if (child) selectChild(child);
            }}
          >
            {children.map((child) => (
              <MenuItem key={child.id} value={child.id}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Avatar
                    src={child.picture_content_type ? `${API_BASE}/children/${child.id}/photo?v=${encodeURIComponent(child.updated_at)}` : undefined}
                    sx={{ width: 24, height: 24, fontSize: 12 }}
                  >
                    {child.first_name[0]}
                  </Avatar>
                  {child.first_name} {child.last_name}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </Box>
      )}
      <Divider />
      <List sx={{ flex: 1, overflowY: "auto" }}>
        {navItems.map((item) => (
          <ListItemButton
            key={item.path}
            selected={location.pathname === item.path}
            onClick={() => {
              navigate(item.path);
              if (isMobile) setDrawerOpen(false);
            }}
            sx={{ py: 1.5 }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
      <Divider />
      {user && (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {user.email}
          </Typography>
        </Box>
      )}
    </Box>
  );

  return (
    <Box sx={{ display: "flex" }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            size="large"
            onClick={() => setDrawerOpen(!drawerOpen)}
            sx={{ mr: 2, display: { md: "none" } }}
            aria-label="open navigation drawer"
          >
            <MenuIcon />
          </IconButton>
          <Box
            onClick={() => navigate("/children")}
            sx={{
              flexGrow: 1,
              display: "flex",
              alignItems: "center",
              gap: 1.25,
              cursor: "pointer",
              minHeight: 44,
              "&:hover": { opacity: 0.85 },
            }}
            role="button"
            tabIndex={0}
            aria-label="Select child"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate("/children");
              }
            }}
          >
            {selectedChild && (
              <Avatar
                src={selectedChild.picture_content_type ? `${API_BASE}/children/${selectedChild.id}/photo?v=${encodeURIComponent(selectedChild.updated_at)}` : undefined}
                sx={{ width: 40, height: 40, fontSize: 16 }}
              >
                {selectedChild.first_name[0]}
              </Avatar>
            )}
            <Typography variant="h6" noWrap>
              {selectedChild
                ? `${selectedChild.first_name}'s Tracker`
                : "Baby Tracker"}
            </Typography>
          </Box>
          <IconButton
            color="inherit"
            size="large"
            onClick={cycleTheme}
            aria-label={themeLabel}
            title={themeLabel}
          >
            {themeIcon}
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Mobile swipeable drawer */}
      <SwipeableDrawer
        variant="temporary"
        open={drawerOpen}
        onOpen={() => setDrawerOpen(true)}
        onClose={() => setDrawerOpen(false)}
        disableBackdropTransition={false}
        disableDiscovery={false}
        sx={{
          display: { xs: "block", md: "none" },
          "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" },
        }}
      >
        {drawer}
      </SwipeableDrawer>

      {/* Desktop drawer */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", md: "block" },
          "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" },
        }}
        open
      >
        {drawer}
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 3 },
          ml: { md: `${DRAWER_WIDTH}px` },
          mt: "64px",
          pb: {
            xs: `calc(${BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom) + 16px)`,
            md: 3,
          },
          minHeight: "calc(100vh - 64px)",
          maxWidth: "100%",
          overflow: "hidden",
        }}
      >
        <Outlet />
      </Box>

      {/* Add log sheet (mobile) */}
      {addSheetOpen && (
        <Box
          onClick={() => setAddSheetOpen(false)}
          sx={{
            display: { xs: "block", md: "none" },
            position: "fixed",
            inset: 0,
            zIndex: (theme) => theme.zIndex.appBar + 1,
            bgcolor: "rgba(0,0,0,0.35)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <Box
            onClick={(e) => e.stopPropagation()}
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: `calc(${BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom))`,
              bgcolor: "background.default",
              borderTopLeftRadius: "24px",
              borderTopRightRadius: "24px",
              boxShadow: "0 -20px 60px rgba(0,0,0,0.25)",
              p: "16px 20px 24px",
            }}
          >
            <Box sx={{ width: 38, height: 4, bgcolor: "text.secondary", opacity: 0.3, mx: "auto", mb: 2, borderRadius: 99 }} />
            <Typography sx={{ fontSize: 18, fontWeight: 700, mb: 2, letterSpacing: "-0.01em" }}>
              Log
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
              {addSheetItems.map((item) => (
                <Box
                  key={item.label}
                  onClick={() => {
                    setAddSheetOpen(false);
                    setQuickLogCategory(item.cat);
                  }}
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.75,
                    py: 1.5,
                    borderRadius: 3,
                    bgcolor: "background.paper",
                    border: 1,
                    borderColor: "divider",
                    cursor: "pointer",
                    "&:active": { transform: "scale(0.96)" },
                  }}
                >
                  <Box sx={{ color: "text.secondary" }}>{item.icon}</Box>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{item.label}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}

      {/* Mobile bottom navigation — PWA style with center FAB */}
      <Box
        sx={{
          display: { xs: "block", md: "none" },
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: (theme) => theme.zIndex.appBar,
          paddingBottom: "env(safe-area-inset-bottom)",
          borderTop: 1,
          borderColor: "divider",
          bgcolor: isDark ? "rgba(12, 16, 24, 0.86)" : "rgba(255, 255, 255, 0.92)",
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            height: BOTTOM_NAV_HEIGHT,
            alignItems: "center",
          }}
        >
          {bottomNavTabs.map((tab) => {
            const isActive = tab.id === activeTab;
            if (tab.isFab) {
              return (
                <Box
                  key={tab.id}
                  sx={{ display: "flex", justifyContent: "center", alignItems: "flex-start" }}
                >
                  <Box
                    onClick={() => handleBottomNav(tab)}
                    sx={{
                      width: 52,
                      height: 52,
                      borderRadius: "18px",
                      mt: "-22px",
                      bgcolor: "primary.main",
                      color: isDark ? "#0c1018" : "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: isDark
                        ? "0 8px 22px rgba(165, 180, 252, 0.45)"
                        : "0 8px 22px rgba(91, 93, 255, 0.35)",
                      border: 4,
                      borderColor: isDark ? "#0c1018" : "#ffffff",
                      cursor: "pointer",
                      "&:active": { transform: "scale(0.92)" },
                    }}
                  >
                    {tab.icon}
                  </Box>
                </Box>
              );
            }
            return (
              <Box
                key={tab.id}
                onClick={() => handleBottomNav(tab)}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "3px",
                  py: 0.5,
                  color: isActive ? "text.primary" : "text.secondary",
                  cursor: "pointer",
                  "&:active": { opacity: 0.7 },
                }}
              >
                {tab.icon}
                <Typography sx={{ fontSize: 10.5, fontWeight: isActive ? 700 : 500, letterSpacing: "-0.005em" }}>
                  {tab.label}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>

      <QuickLogDialog
        category={quickLogCategory}
        onClose={() => setQuickLogCategory(null)}
      />
    </Box>
  );
}
