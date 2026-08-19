import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
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
  ToggleButton,
  ToggleButtonGroup,
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
import ErrorBoundary from "./ErrorBoundary";
import { useAuth } from "../hooks/useAuth";
import { useChildren } from "../hooks/useChildren";
import { useDataFreshness } from "../hooks/useDataFreshness";
import { useDataRefresh } from "../hooks/useDataRefresh";
import { useThemeMode } from "../hooks/useTheme";
import { useVolumeUnit } from "../hooks/useVolumeUnit";
import { formatRelativeTime } from "../utils/dateTime";
import { unitLabel, VOLUME_UNITS, type VolumeUnit } from "../utils/feedingAmount";
import { api, API_BASE } from "../api/client";
import { useNotification } from "../hooks/useNotification";
import { childPhotoUrl } from "../utils/childMoments";
import QuickLogDialog, { type QuickLogCategory } from "./QuickLogDialog";

const DRAWER_WIDTH = 240;
const BOTTOM_NAV_HEIGHT = 68;
const APPBAR_HEIGHT_MOBILE = 48;
const APPBAR_HEIGHT_DESKTOP = 56;
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
  // Deliberately not a visible button anywhere in the normal flow — this is a
  // maintenance action ("regenerate today's AI note instead of waiting for
  // the midnight cron"), not something either of us should be able to bump
  // into by accident. Tapping the build info five times quickly reveals it
  // for the rest of this drawer visit; it's hidden again next time the
  // drawer opens.
  const [buildTapCount, setBuildTapCount] = useState(0);
  const [regeneratingNotes, setRegeneratingNotes] = useState(false);
  const REVEAL_TAPS = 5;
  const handleBuildTap = () => setBuildTapCount((n) => n + 1);
  // Closing the drawer re-hides the reveal rather than leaving it unlocked
  // for the rest of the session.
  useEffect(() => {
    if (!drawerOpen) setBuildTapCount(0);
  }, [drawerOpen]);
  const handleRegenerateNotes = async () => {
    setRegeneratingNotes(true);
    try {
      // postSlow, not post: this runs a model per child server-side and the
      // ordinary 12s CRUD deadline aborted it mid-generation.
      const { written } = await api.postSlow<{ written: { source: string; reason?: string }[] }>(
        "/daily-notes/refresh",
        {},
      );
      const fromAi = written.filter((n) => n.source === "ai").length;
      // When nothing came from the model, say why rather than just "0 from
      // AI" — that number alone sent us guessing at the cause twice.
      const why = [...new Set(written.map((n) => n.reason).filter(Boolean))].join("; ");
      notify(
        written.length === 0
          ? "No children to write a note for."
          : fromAi === 0 && why
            ? `Wrote ${written.length} note${written.length === 1 ? "" : "s"}, none from AI — ${why}`
            : `Wrote ${written.length} note${written.length === 1 ? "" : "s"} (${fromAi} from AI).`,
        fromAi === 0 && written.length > 0 ? "warning" : "success",
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to regenerate notes.", "error");
    } finally {
      setRegeneratingNotes(false);
    }
  };
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { children, selectedChild, selectChild } = useChildren();
  const { preference, setPreference } = useThemeMode();
  const { unit: volumeUnit, setUnit: setVolumeUnit } = useVolumeUnit();
  const { staleSince } = useDataFreshness();
  const { refreshData } = useDataRefresh();
  const { notify } = useNotification();
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
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        bgcolor: "background.paper",
      }}
    >
      <Box
        sx={{
          minHeight: {
            xs: `calc(${APPBAR_HEIGHT_MOBILE}px + env(safe-area-inset-top))`,
            md: `${APPBAR_HEIGHT_DESKTOP}px`,
          },
        }}
      />
      {children.length > 1 && (
        <Box sx={{ px: 2, pb: 1.5 }}>
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
                    src={childPhotoUrl(child, API_BASE) ?? undefined}
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
      <List sx={{ flex: 1, overflowY: "auto", py: 1 }}>
        {navItems.map((item) => (
          <ListItemButton
            key={item.path}
            selected={location.pathname === item.path}
            onClick={() => {
              navigate(item.path);
              if (isMobile) setDrawerOpen(false);
            }}
            sx={{ py: 1.1, mb: 0.25 }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText
              primary={item.label}
              slotProps={{
                primary: {
                  sx: {
                    fontSize: 14.5,
                    fontWeight: location.pathname === item.path ? 600 : 500,
                    letterSpacing: "-0.005em",
                  },
                },
              }}
            />
          </ListItemButton>
        ))}
      </List>
      <Divider />
      {/* Every bottle, pumping session, total and chart is shown in this unit,
          whichever unit each entry happened to be logged in. */}
      <Box sx={{ px: 2, py: 1.5 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", display: "block", mb: 0.75 }}
        >
          Volume units
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          fullWidth
          value={volumeUnit}
          onChange={(_, next: VolumeUnit | null) => {
            if (next) setVolumeUnit(next);
          }}
          aria-label="Volume units"
        >
          {VOLUME_UNITS.map((u) => (
            <ToggleButton key={u} value={u} sx={{ py: 0.4, fontSize: 13, textTransform: "none" }}>
              {unitLabel(u)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
      {user && (
        <>
          <Divider />
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", display: "block", mb: 0.25 }}
            >
              Signed in
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
              {user.email}
            </Typography>
            {/* An installed app can lag a deploy by design — the reload waits
                until it can't cost anyone a half-filled form — so this is how
                you tell whether a device has actually picked one up. Tapping
                it repeatedly reveals the buried "regenerate note" action
                below — an ordinary label to anyone who doesn't already know
                that, which is the point. */}
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              onClick={handleBuildTap}
              sx={{ cursor: "default", userSelect: "none" }}
            >
              Build {__BUILD_ID__} · {new Date(__BUILD_TIME__).toLocaleString()}
            </Typography>
            {buildTapCount >= REVEAL_TAPS && (
              <Button
                size="small"
                onClick={handleRegenerateNotes}
                disabled={regeneratingNotes}
                sx={{ mt: 1, fontSize: 11.5, textTransform: "none", color: "text.secondary" }}
              >
                {regeneratingNotes ? "Regenerating…" : "Regenerate today's note"}
              </Button>
            )}
          </Box>
        </>
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
        <Toolbar
          variant="dense"
          sx={{
            minHeight: { xs: APPBAR_HEIGHT_MOBILE, md: APPBAR_HEIGHT_DESKTOP },
            px: { xs: 1, sm: 1.5 },
          }}
        >
          <IconButton
            color="inherit"
            edge="start"
            size="small"
            onClick={() => setDrawerOpen(!drawerOpen)}
            sx={{ mr: 1, display: { md: "none" }, minWidth: 36, minHeight: 36 }}
            aria-label="open navigation drawer"
          >
            <MenuIcon sx={{ fontSize: 22 }} />
          </IconButton>
          <Box
            onClick={() => navigate("/children")}
            sx={{
              flexGrow: 1,
              display: "flex",
              alignItems: "center",
              gap: 1,
              cursor: "pointer",
              minHeight: 36,
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
                src={childPhotoUrl(selectedChild, API_BASE) ?? undefined}
                sx={{ width: 28, height: 28, fontSize: 12 }}
              >
                {selectedChild.first_name[0]}
              </Avatar>
            )}
            <Typography sx={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }} noWrap>
              {selectedChild
                ? `${selectedChild.first_name}'s Tracker`
                : "Baby Tracker"}
            </Typography>
          </Box>
          <IconButton
            color="inherit"
            size="small"
            onClick={cycleTheme}
            aria-label={themeLabel}
            title={themeLabel}
            sx={{ minWidth: 36, minHeight: 36 }}
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
          p: { xs: 1.5, sm: 3 },
          ml: { md: `${DRAWER_WIDTH}px` },
          mt: {
            xs: `calc(${APPBAR_HEIGHT_MOBILE}px + env(safe-area-inset-top))`,
            md: `${APPBAR_HEIGHT_DESKTOP}px`,
          },
          pb: {
            xs: `calc(${BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom) + 16px)`,
            md: 3,
          },
          minHeight: {
            xs: `calc(100vh - ${APPBAR_HEIGHT_MOBILE}px)`,
            md: `calc(100vh - ${APPBAR_HEIGHT_DESKTOP}px)`,
          },
          maxWidth: "100%",
          overflow: "hidden",
        }}
      >
        {/* Nothing caches API data anymore, so what's on screen is whatever
            the last successful refresh brought back. These screens are read as
            current state — how long since the last feed, whether anyone has
            changed her — so the moment a refresh fails, the age of what's
            showing has to be said out loud rather than left to look live. */}
        {staleSince !== null && (
          <Alert
            severity="warning"
            variant="outlined"
            sx={{ mb: 2, alignItems: "center" }}
            action={
              <Button color="inherit" size="small" onClick={refreshData}>
                Retry
              </Button>
            }
          >
            Can't reach the server — showing data from{" "}
            {formatRelativeTime(new Date(staleSince).toISOString())}. New
            entries from other devices aren't here yet; retrying automatically.
          </Alert>
        )}
        {/* Keyed on the route so navigating away clears a crashed page rather
            than pinning the error in place for the rest of the session. The
            nav around it stays usable, which is the whole point of catching
            here as well as at the top. */}
        <ErrorBoundary key={location.pathname} scope="This page failed to load">
          <Outlet />
        </ErrorBoundary>
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
          {/* This sheet is a modal in every sense except the markup, which is
              what `isUserBusy` reads: without the role a background refresh
              fires straight through an open sheet and rebuilds the page
              underneath it. Unlike MUI's Dialog, which sets this itself, a
              hand-rolled sheet has to say so. */}
          <Box
            role="dialog"
            aria-modal="true"
            aria-labelledby="log-sheet-title"
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
            <Typography id="log-sheet-title" sx={{ fontSize: 18, fontWeight: 700, mb: 2, letterSpacing: "-0.01em" }}>
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
