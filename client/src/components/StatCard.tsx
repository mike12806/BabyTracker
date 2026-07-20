import { Box, Typography } from "@mui/material";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sublabel?: string;
  accentColor: string;
}

/** Compact stat card used in summary strips across log pages. */
export default function StatCard({ label, value, sublabel, accentColor }: StatCardProps) {
  const valueText = typeof value === "string" || typeof value === "number" ? String(value) : "";
  // Auto-shrink longer values so they fit without crowding the card
  const valueFontSize = valueText.length > 8 ? 11 : valueText.length > 5 ? 13 : 15;

  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderLeftWidth: 3,
        borderLeftColor: accentColor,
        borderRadius: 1.25,
        p: "5px 9px",
        position: "relative",
        overflow: "hidden",
        boxShadow: 0,
        minWidth: 0,
      }}
    >
      <Typography
        sx={{
          fontSize: 9.5,
          color: "text.secondary",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          lineHeight: 1.15,
        }}
        noWrap
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: valueFontSize,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          mt: 0.125,
          fontVariantNumeric: "tabular-nums",
        }}
        noWrap
      >
        {value}
      </Typography>
      {sublabel && (
        <Typography
          sx={{ fontSize: 9.5, color: "text.secondary", lineHeight: 1.15, mt: 0 }}
          noWrap
        >
          {sublabel}
        </Typography>
      )}
    </Box>
  );
}
