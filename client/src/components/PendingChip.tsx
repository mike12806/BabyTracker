import { Box, Tooltip } from "@mui/material";
import CloudOffIcon from "@mui/icons-material/CloudOff";

/**
 * The mark on an entry that exists only on this device.
 *
 * Every list in the app mixes saved rows with queued ones, because leaving a
 * feed logged ten minutes ago out of the log until the wifi comes back would
 * make the screen answer "when did she last eat" wrongly. What that costs is
 * the guarantee that everything on screen is something the other caregiver can
 * also see — so it has to be paid back here, per row, rather than assumed from
 * the banner at the top of the page that the user may have scrolled past.
 *
 * Deliberately small and quiet. It is a caveat on a real entry, not a warning:
 * the data is fine, it is only somewhere else that it hasn't arrived.
 */
export default function PendingChip({ compact = false }: { compact?: boolean }) {
  return (
    <Tooltip title="Saved on this device — not sent to the server yet">
      <Box
        component="span"
        aria-label="Not synced"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.375,
          flexShrink: 0,
          verticalAlign: "middle",
          px: compact ? 0.5 : 0.625,
          py: 0.125,
          ml: 0.5,
          borderRadius: 1,
          border: 1,
          borderColor: "divider",
          color: "text.secondary",
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          lineHeight: 1.6,
        }}
      >
        <CloudOffIcon sx={{ fontSize: 11 }} />
        {!compact && "Not synced"}
      </Box>
    </Tooltip>
  );
}
