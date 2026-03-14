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
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import { useAuth } from "../hooks/useAuth";
import { useChildren } from "../hooks/useChildren";
import { useThemeMode } from "../hooks/useTheme";
import { API_BASE } from "../api/client";

const DRAWER_WIDTH = 240;

const navItems = [
  { label: "Dashboard", icon: <DashboardIcon />, path: "/" },
  { label: "Feedings", icon: <RestaurantIcon />, path: "/feedings" },
  { label: "Diapers", icon: <BabyChangingStationIcon />, path: "/diapers" },
  { label: "Sleep", icon: <BedtimeIcon />, path: "/sleep" },
  { label: "Tummy Time", icon: <AccessibilityNewIcon />, path: "/tummy-time" },
  { label: "Pumping", icon: <OpacityIcon />, path: "/pumping" },
  { label: "Growth", icon: <MonitorWeightIcon />, path: "/growth" },
  { label: "Temperature", icon: <ThermostatIcon />, path: "/temperature" },
  { label: "Notes", icon: <NoteIcon />, path: "/notes" },
  { label: "Timers", icon: <TimerIcon />, path: "/timers" },
  { label: "Children", icon: <ChildCareIcon />, path: "/children" },
];

export default function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { children, selectedChild, selectChild } = useChildren();
  const { mode, toggleMode } = useThemeMode();
  const muiTheme = useTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down("md"));

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
                    src={child.picture_content_type ? `${API_BASE}/children/${child.id}/photo` : undefined}
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
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setDrawerOpen(!drawerOpen)}
            sx={{ mr: 2, display: { md: "none" } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ flexGrow: 1, display: "flex", alignItems: "center", gap: 1 }}>
            {selectedChild && (
              <Avatar
                src={selectedChild.picture_content_type ? `${API_BASE}/children/${selectedChild.id}/photo` : undefined}
                sx={{ width: 32, height: 32, fontSize: 14 }}
              >
                {selectedChild.first_name[0]}
              </Avatar>
            )}
            {selectedChild
              ? `${selectedChild.first_name}'s Tracker`
              : "Baby Tracker"}
          </Typography>
          <IconButton color="inherit" onClick={toggleMode} aria-label="Toggle dark mode">
            {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Mobile drawer */}
      <Drawer
        variant="temporary"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sx={{
          display: { xs: "block", md: "none" },
          "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" },
        }}
      >
        {drawer}
      </Drawer>

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
          minHeight: "calc(100vh - 64px)",
          maxWidth: "100%",
          overflow: "hidden",
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
