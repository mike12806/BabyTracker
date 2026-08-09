import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import RestaurantIcon from "@mui/icons-material/Restaurant";
import BabyChangingStationIcon from "@mui/icons-material/BabyChangingStation";
import BedtimeIcon from "@mui/icons-material/Bedtime";
import OpacityIcon from "@mui/icons-material/Opacity";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useDataRefresh } from "../hooks/useDataRefresh";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import { unitLabel, volumeTotal } from "../utils/feedingAmount";
import { useVolumeUnit } from "../hooks/useVolumeUnit";
import {
  FeedingChart,
  DiaperChart,
  SleepChart,
  PumpingChart,
  lastNDays,
  toDateKey,
} from "../components/Charts";
import { buildCategoryColors, type CategoryKey } from "../theme/categoryColors";
import type {
  Feeding,
  DiaperChange,
  SleepEntry,
  Pumping,
} from "../types/models";

type RangeKey = "7" | "30" | "all";

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "all", label: "All time" },
];

function daysForRange(range: RangeKey): number {
  if (range === "7") return 7;
  if (range === "30") return 30;
  return 365;
}

function rangeSubtitle(range: RangeKey): string {
  if (range === "7") return "Last 7 days";
  if (range === "30") return "Last 30 days";
  return "All time";
}

export default function ChartsPage() {
  const { selectedChild } = useChildren();
  const { refreshKey } = useDataRefresh();
  const { unit } = useVolumeUnit();
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const colors = useMemo(() => buildCategoryColors(dark), [dark]);

  const [range, setRange] = useState<RangeKey>("7");
  const [loading, setLoading] = useState(true);
  const [feedings, setFeedings] = useState<Feeding[]>([]);
  const [diapers, setDiapers] = useState<DiaperChange[]>([]);
  const [sleeps, setSleeps] = useState<SleepEntry[]>([]);
  const [pumpings, setPumpings] = useState<Pumping[]>([]);

  useEffect(() => {
    if (!selectedChild) return;
    setLoading(true);
    Promise.all([
      api.get<Feeding[]>(`/feedings?child_id=${selectedChild.id}&limit=500`),
      api.get<DiaperChange[]>(`/diaper-changes?child_id=${selectedChild.id}&limit=500`),
      api.get<SleepEntry[]>(`/sleep?child_id=${selectedChild.id}&limit=500`),
      api.get<Pumping[]>(`/pumping?child_id=${selectedChild.id}&limit=500`),
    ]).then(([f, d, s, p]) => {
      setFeedings(f);
      setDiapers(d);
      setSleeps(s);
      setPumpings(p);
      setLoading(false);
    });
  }, [selectedChild, refreshKey]);

  if (!selectedChild) return <NoChildPlaceholder />;

  const days = daysForRange(range);

  // The charts bucket entries by local calendar day over the last N days. The
  // averages printed above them cover exactly those days, so a headline never
  // summarises a window the chart below it does not draw.
  const chartedDays = new Set(lastNDays(days));
  const onChart = <T,>(items: T[], timeOf: (item: T) => string): T[] =>
    items.filter((i) => chartedDays.has(toDateKey(timeOf(i))));

  const filteredFeedings = onChart(feedings, (f) => f.start_time);

  // Prefer the amount fed per day; fall back to feedings per day when no
  // amounts have been recorded (e.g. breastfeeding only). Volumes logged in
  // different units are converted into the display unit rather than dropped,
  // so the average is in the same unit as the chart's axis.
  const feedVolume = volumeTotal(filteredFeedings, unit);
  const avgFeedings =
    days > 0
      ? (feedVolume != null ? feedVolume / days : filteredFeedings.length / days).toFixed(1)
      : "0";
  const avgFeedingsLabel = feedVolume != null ? `${unitLabel(unit)}/day` : "/day";

  const avgDiapers = days > 0 ? (onChart(diapers, (d) => d.time).length / days).toFixed(1) : "0";

  const filteredSleeps = onChart(sleeps.filter((s) => s.end_time), (s) => s.start_time);
  const totalSleepHrs = filteredSleeps.reduce((sum, s) => {
    if (!s.end_time) return sum;
    return sum + (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 3600000;
  }, 0);
  const avgSleep = days > 0 ? (totalSleepHrs / days).toFixed(1) : "0";

  const filteredPumpings = onChart(pumpings, (p) => p.start_time);
  // Sessions in different units are converted before they are added up —
  // summing the raw numbers would treat an ounce as a millilitre.
  const pumpVolume = volumeTotal(filteredPumpings, unit);
  const avgPump = days > 0 && pumpVolume != null ? (pumpVolume / days).toFixed(1) : "0";
  const pumpUnit = unitLabel(unit);

  interface SectionDef {
    key: string;
    category: CategoryKey;
    title: string;
    subtitle: string;
    avg: string;
    avgLabel: string;
    icon: React.ReactNode;
    chart: React.ReactNode;
  }

  const sections: SectionDef[] = [
    {
      key: "feed",
      category: "feed",
      title: "Feeding",
      subtitle: "Breast, bottle & solids",
      avg: avgFeedings,
      avgLabel: avgFeedingsLabel,
      icon: <RestaurantIcon sx={{ fontSize: 18 }} />,
      chart: <FeedingChart feedings={feedings} days={days} />,
    },
    {
      key: "diaper",
      category: "diaper",
      title: "Diapers",
      subtitle: "Wet, solid & both",
      avg: avgDiapers,
      avgLabel: "/day",
      icon: <BabyChangingStationIcon sx={{ fontSize: 18 }} />,
      chart: <DiaperChart diapers={diapers} days={days} />,
    },
    {
      key: "sleep",
      category: "sleep",
      title: "Sleep",
      subtitle: "Night & nap hours",
      avg: avgSleep,
      avgLabel: "h/day",
      icon: <BedtimeIcon sx={{ fontSize: 18 }} />,
      chart: <SleepChart sleeps={sleeps} days={days} />,
    },
    {
      key: "pump",
      category: "pump",
      title: "Pumping",
      subtitle: `Daily ${pumpUnit} pumped`,
      avg: avgPump,
      avgLabel: `${pumpUnit}/day`,
      icon: <OpacityIcon sx={{ fontSize: 18 }} />,
      chart: <PumpingChart pumpings={pumpings} days={days} />,
    },
  ];

  return (
    <Box>
      {/* Header */}
      <Typography sx={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
        Trends
      </Typography>
      <Typography sx={{ fontSize: 12, color: "text.secondary", mb: 1.25 }}>
        {rangeSubtitle(range)}
      </Typography>

      {/* Filter pills */}
      <Stack
        direction="row"
        spacing={0.75}
        sx={{
          mb: 1.5,
          overflowX: "auto",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {RANGE_OPTIONS.map((opt) => (
          <Chip
            key={opt.key}
            label={opt.label}
            size="small"
            variant={range === opt.key ? "filled" : "outlined"}
            color={range === opt.key ? "primary" : "default"}
            onClick={() => setRange(opt.key)}
            sx={{ fontWeight: 600, flexShrink: 0, fontSize: 12, height: 26 }}
          />
        ))}
      </Stack>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <Stack spacing={1.25}>
          {sections.map((sec) => {
            const cat = colors[sec.category];
            return (
              <Card
                key={sec.key}
                elevation={0}
                sx={{
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 2.5,
                  overflow: "hidden",
                }}
              >
                {/* Colored left gutter via a left border */}
                <Box sx={{ borderLeft: `2px solid ${cat.solid}` }}>
                  <CardContent sx={{ p: "10px 12px !important" }}>
                    {/* Card header row */}
                    <Stack
                      direction="row"
                      sx={{ alignItems: "center", mb: 0.75 }}
                      spacing={1}
                    >
                      {/* Icon tile */}
                      <Box
                        sx={{
                          width: 22,
                          height: 22,
                          borderRadius: 1,
                          bgcolor: cat.tile,
                          color: cat.solid,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          "& svg": { fontSize: 14 },
                        }}
                      >
                        {sec.icon}
                      </Box>

                      {/* Title + subtitle */}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.15 }}
                          noWrap
                        >
                          {sec.title}
                        </Typography>
                        <Typography
                          sx={{ fontSize: 10.5, color: "text.secondary", lineHeight: 1.15 }}
                          noWrap
                        >
                          {sec.subtitle}
                        </Typography>
                      </Box>

                      {/* Avg value */}
                      <Box sx={{ textAlign: "right", flexShrink: 0 }}>
                        <Typography
                          sx={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1, color: cat.solid, fontVariantNumeric: "tabular-nums" }}
                        >
                          {sec.avg}
                        </Typography>
                        <Typography
                          sx={{ fontSize: 10, color: "text.secondary", lineHeight: 1 }}
                        >
                          {sec.avgLabel}
                        </Typography>
                      </Box>
                    </Stack>

                    {/* Chart */}
                    <Box
                      sx={{
                        mx: -0.5,
                        "& .recharts-responsive-container": {
                          height: "130px !important",
                        },
                      }}
                    >
                      {sec.chart}
                    </Box>
                  </CardContent>
                </Box>
              </Card>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
