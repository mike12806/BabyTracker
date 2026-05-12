import { useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  AppBar,
  Avatar,
  Box,
  BottomNavigation,
  BottomNavigationAction,
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
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import SettingsBrightnessIcon from "@mui/icons-material/SettingsBrightness";
import { useAuth } from "../hooks/useAuth";
import { useChildren } from "../hooks/useChildren";
import { useThemeMode } from "../hooks/useTheme";
import { API_BASE } from "../api/client";

const DRAWER_WIDTH = 240;
const BOTTOM_NAV_HEIGHT = 56;

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
  { label: "Notes", icon: <NoteIcon />, path: "/notes" },
  { label: "Timers", icon: <TimerIcon />, path: "/timers" },
  { label: "Activity", icon: <HistoryIcon />, path: "/activity" },
  { label: "Children", icon: <ChildCareIcon />, path: "/children" },
];

// Bottom-nav surfaces the top destinations; paths must exist in navItems above.
const bottomNavPaths = ["/", "/feedings", "/diapers", "/sleep"];
const bottomNavItems = bottomNavPaths
  .map((path) => navItems.find((item) => item.path === path))
  .filter((item): item is (typeof navItems)[number] => item !== undefined);

export default function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { children, selectedChild, selectChild } = useChildren();
  const { preference, setPreference } = useThemeMode();
  const muiTheme = useTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down("md"));
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

  const bottomNavValue = bottomNavPaths.includes(location.pathname)
    ? location.pathname
    : "more";

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

      {/* Mobile bottom navigation */}
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
          backgroundColor: "background.paper",
        }}
      >
        <BottomNavigation
          showLabels
          value={bottomNavValue}
          onChange={(_, newValue) => {
            if (newValue === "more") {
              setDrawerOpen(true);
            } else {
              navigate(newValue);
            }
          }}
          sx={{ height: BOTTOM_NAV_HEIGHT }}
        >
          {bottomNavItems.map((item) => (
            <BottomNavigationAction
              key={item.path}
              label={item.label}
              icon={item.icon}
              value={item.path}
            />
          ))}
          <BottomNavigationAction
            label="More"
            icon={<MoreHorizIcon />}
            value="more"
          />
        </BottomNavigation>
      </Box>
    </Box>
  );
}
