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
  const valueFontSize = valueText.length > 8 ? 13 : valueText.length > 5 ? 15 : 18;

  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: 2.5,
        p: "9px 11px",
        position: "relative",
        overflow: "hidden",
        boxShadow: 1,
        minWidth: 0,
      }}
    >
      <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, bgcolor: accentColor }} />
      <Typography
        sx={{
          fontSize: 10.5,
          color: "text.secondary",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          lineHeight: 1.2,
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
          lineHeight: 1.15,
          mt: 0.25,
          fontVariantNumeric: "tabular-nums",
        }}
        noWrap
      >
        {value}
      </Typography>
      {sublabel && (
        <Typography
          sx={{ fontSize: 11, color: "text.secondary", lineHeight: 1.2, mt: 0.125 }}
          noWrap
        >
          {sublabel}
        </Typography>
      )}
    </Box>
  );
}
