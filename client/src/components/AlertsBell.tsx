import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Typography,
  useTheme,
} from "@mui/material";
import NotificationsNoneRoundedIcon from "@mui/icons-material/NotificationsNoneRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import BabyChangingStationIcon from "@mui/icons-material/BabyChangingStation";
import RestaurantIcon from "@mui/icons-material/Restaurant";
import TrendingDownRoundedIcon from "@mui/icons-material/TrendingDownRounded";
import NotificationsOffRoundedIcon from "@mui/icons-material/NotificationsOffRounded";
import { fetchAlerts, markAlertsRead } from "../api/alerts";
import { useDataRefresh } from "../hooks/useDataRefresh";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { formatRelativeTime } from "../utils/dateTime";
import { buildCategoryColors, type CategoryKey } from "../theme/categoryColors";
import type { Alert } from "../types/models";

/**
 * The alerts bell, and the drawer behind it.
 *
 * This is the app's own copy of the notifications it sends — see
 * `server/src/alerts.ts` for why the push alone was not enough. Two things
 * follow from that and are worth not undoing:
 *
 *  - **It is a record, not a second decision.** Nothing here works out whether
 *    a feed is overdue; it renders the sentence the server sent, as sent. A
 *    trend alert's figures describe the moment it was raised, so recomputing
 *    them against the current clock would put words in its mouth.
 *  - **It is never cached**, like every other read in this app. A closed
 *    drawer holds whatever the last fetch returned, and the feed refetches
 *    with everything else on `refreshKey`.
 */

const KIND_ICON: Record<Alert["kind"], { icon: React.ReactNode; category: CategoryKey }> = {
  diaper: { icon: <BabyChangingStationIcon sx={{ fontSize: 18 }} />, category: "diaper" },
  feeding: { icon: <RestaurantIcon sx={{ fontSize: 18 }} />, category: "feed" },
  feeding_trend: { icon: <TrendingDownRoundedIcon sx={{ fontSize: 18 }} />, category: "feed" },
};

export default function AlertsBell() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /**
   * The read mark as it stood when the drawer was opened.
   *
   * Opening marks the feed read, which is what clears the badge — but the
   * rows that *were* new still need to be marked for as long as you are
   * looking at them, or the drawer answers "what's new?" with an undifferentiated
   * list. Frozen here for the visit, rather than read from the live feed.
   */
  const [newSince, setNewSince] = useState<string | null>(null);

  const navigate = useNavigate();
  const { refreshKey } = useDataRefresh();
  const { supported: pushSupported, subscribed: pushSubscribed, working: pushWorking, subscribe } =
    usePushNotifications();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const feed = await fetchAlerts();
      setAlerts(feed.alerts);
      setUnread(feed.unread);
      setFailed(false);
      return feed;
    } catch {
      // The bell is garnish next to the numbers on the page behind it — the
      // request is `optional` so it hasn't raised the stale banner, and the
      // badge simply stops claiming a count it can't stand behind.
      setFailed(true);
      setUnread(0);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Alongside everything else the app refetches: the foreground poll, coming
  // back to the app, and every save. A bell that only loaded once would go on
  // showing the count from whenever the app was opened.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleOpen = async () => {
    setOpen(true);
    const feed = await load();
    if (!feed) return;
    setNewSince(feed.last_read_at);
    if (feed.unread === 0) return;
    // Read as far as the newest row that is actually on screen — not "now",
    // which would swallow an alert raised in the seconds since the fetch.
    try {
      await markAlertsRead(feed.alerts[0]?.created_at ?? null);
      setUnread(0);
    } catch {
      // The badge stays up. Better a count that clears on the next visit than
      // one cleared locally against a server that never recorded it.
    }
  };

  const isNew = (alert: Alert) => newSince === null || alert.created_at > newSince;

  const body = (
    <Box sx={{ width: { xs: "86vw", sm: 380 }, maxWidth: 420, display: "flex", flexDirection: "column", height: "100%" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          px: 2,
          pt: "calc(env(safe-area-inset-top) + 12px)",
          pb: 1.5,
        }}
      >
        <Typography sx={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>Alerts</Typography>
        <IconButton size="small" onClick={() => setOpen(false)} aria-label="Close alerts">
          <CloseRoundedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>
      <Divider />

      <Box sx={{ flex: 1, overflowY: "auto" }}>
        {loading && alerts.length === 0 && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}>
            <CircularProgress size={22} />
          </Box>
        )}

        {!loading && failed && alerts.length === 0 && (
          <Box sx={{ px: 2.5, py: 5, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              Couldn't load alerts just now.
            </Typography>
            <Button size="small" onClick={() => void load()} sx={{ mt: 1, textTransform: "none" }}>
              Try again
            </Button>
          </Box>
        )}

        {!loading && !failed && alerts.length === 0 && (
          <Box sx={{ px: 3, py: 6, textAlign: "center" }}>
            <NotificationsNoneRoundedIcon sx={{ fontSize: 34, color: "text.disabled", mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              Nothing to report.
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
              Overdue diaper and feeding reminders, and feeding-trend alerts, land here — whether or
              not this device gets the notification.
            </Typography>
          </Box>
        )}

        {alerts.map((alert) => {
          const kind = KIND_ICON[alert.kind] ?? KIND_ICON.feeding;
          const colors = cat[kind.category];
          const fresh = isNew(alert);
          return (
            <Box
              key={alert.id}
              onClick={() => {
                setOpen(false);
                navigate(alert.url || "/");
              }}
              sx={{
                display: "flex",
                gap: 1.5,
                px: 2,
                py: 1.5,
                cursor: "pointer",
                borderBottom: 1,
                borderColor: "divider",
                bgcolor: fresh ? colors.soft : "transparent",
                "&:active": { opacity: 0.75 },
              }}
            >
              <Box
                sx={{
                  flexShrink: 0,
                  width: 32,
                  height: 32,
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: colors.tile,
                  color: colors.ink,
                }}
              >
                {kind.icon}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.005em" }} noWrap>
                    {alert.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ ml: "auto", flexShrink: 0 }}>
                    {formatRelativeTime(alert.created_at)}
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.4, mt: 0.25 }}>{alert.body}</Typography>
                {fresh && (
                  <Typography
                    variant="caption"
                    sx={{ color: colors.ink, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}
                  >
                    New
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* The one place worth saying that push and this list are different
          things: someone reading an alert here days late is exactly the person
          who would rather their phone had told them. */}
      {pushSupported && !pushSubscribed && (
        <>
          <Divider />
          <Box sx={{ px: 2, py: 1.75, display: "flex", alignItems: "center", gap: 1.5 }}>
            <NotificationsOffRoundedIcon sx={{ fontSize: 20, color: "text.secondary", flexShrink: 0 }} />
            <Typography variant="body2" sx={{ fontSize: 12.5, flex: 1 }} color="text.secondary">
              Notifications are off on this device. Alerts still collect here.
            </Typography>
            <Button
              size="small"
              disabled={pushWorking}
              onClick={() => {
                subscribe().catch(() => {});
              }}
              sx={{ textTransform: "none", fontWeight: 700, flexShrink: 0 }}
            >
              Turn on
            </Button>
          </Box>
        </>
      )}
    </Box>
  );

  return (
    <>
      <IconButton
        color="inherit"
        size="small"
        onClick={() => void handleOpen()}
        aria-label={unread > 0 ? `Alerts (${unread} new)` : "Alerts"}
        title="Alerts"
        sx={{ minWidth: 36, minHeight: 36 }}
      >
        <Badge
          badgeContent={unread}
          max={99}
          color="error"
          slotProps={{ badge: { sx: { fontSize: 10, height: 16, minWidth: 16 } } }}
        >
          <NotificationsNoneRoundedIcon sx={{ fontSize: 22 }} />
        </Badge>
      </IconButton>

      <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
        {body}
      </Drawer>
    </>
  );
}
