import { useMemo } from "react";
import { useTheme } from "@mui/material/styles";
import {
  BarChart,
  Bar,
  ComposedChart,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { unitLabel, volumeTotal } from "../utils/feedingAmount";
import { useVolumeUnit } from "../hooks/useVolumeUnit";
import type {
  Feeding,
  DiaperChange,
  SleepEntry,
  Pumping,
  Growth,
  TummyTime,
} from "../types/models";

// Must match the height the chart cards give the container. Recharts sizes the
// SVG from this prop, so a container CSS-forced to a different height would
// leave the chart overflowing into whatever sits below it.
const CHART_HEIGHT = 130;
const CHART_MARGIN = { top: 4, right: 12, bottom: 0, left: 0 };
const TICK_STYLE = { fontSize: 10 };

/** Build an array of YYYY-MM-DD strings for the last N days in local time */
export function lastNDays(n: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(toLocalDateStr(d));
  }
  return days;
}

function toLocalDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Convert an ISO timestamp to a local YYYY-MM-DD key */
export function toDateKey(iso: string): string {
  return toLocalDateStr(new Date(iso));
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Feeding Chart ──────────────────────────────────────────────

interface FeedingChartProps {
  feedings: Feeding[];
  days?: number;
}

export function FeedingChart({ feedings, days = 14 }: FeedingChartProps) {
  const theme = useTheme();
  // The amount axis is in the unit the rest of the app displays, so the line
  // and the average printed above it are the same measure. A solid logged in
  // grams is a mass and stays off a volume axis.
  const { unit } = useVolumeUnit();
  const data = useMemo(() => {
    const dateKeys = lastNDays(days);
    const map: Record<string, { breast: number; bottle: number; solid: number; entries: Feeding[] }> = {};
    for (const d of dateKeys) map[d] = { breast: 0, bottle: 0, solid: 0, entries: [] };

    for (const f of feedings) {
      const key = toDateKey(f.start_time);
      if (!map[key]) continue;
      if (f.type === "bottle_breast_milk" || f.type === "bottle_formula" || f.type === "fortified_breast_milk") map[key].bottle++;
      else if (f.type === "solid") map[key].solid++;
      else map[key].breast++;
      map[key].entries.push(f);
    }

    return dateKeys.map((d) => ({
      date: formatDateLabel(d),
      Breast: map[d].breast,
      Bottle: map[d].bottle,
      Solid: map[d].solid,
      Amount: volumeTotal(map[d].entries, unit) ?? undefined,
    }));
  }, [feedings, days, unit]);

  const hasAmount = data.some((d) => d.Amount !== undefined);
  const unitText = unitLabel(unit);

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
        <XAxis dataKey="date" tick={TICK_STYLE} tickMargin={6} />
        <YAxis yAxisId="count" allowDecimals={false} tick={TICK_STYLE} width={28} />
        {hasAmount && (
          <YAxis
            yAxisId="amount"
            orientation="right"
            tick={TICK_STYLE}
            unit={unitText}
            width={36}
          />
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 8,
          }}
          formatter={(value, name) => {
            if (name === "Amount") return [`${value} ${unitText}`, "Amount"];
            return [value, name];
          }}
        />
        <Bar yAxisId="count" dataKey="Breast" stackId="a" fill="#7e57c2" radius={[0, 0, 0, 0]} />
        <Bar yAxisId="count" dataKey="Bottle" stackId="a" fill="#42a5f5" />
        <Bar yAxisId="count" dataKey="Solid" stackId="a" fill="#66bb6a" radius={[4, 4, 0, 0]} />
        {hasAmount && (
          <Line
            yAxisId="amount"
            type="monotone"
            dataKey="Amount"
            stroke="#ff7043"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Diaper Chart ──────────────────────────────────────────────

interface DiaperChartProps {
  diapers: DiaperChange[];
  days?: number;
}

export function DiaperChart({ diapers, days = 14 }: DiaperChartProps) {
  const theme = useTheme();
  const data = useMemo(() => {
    const dateKeys = lastNDays(days);
    const map: Record<string, { wet: number; solid: number; both: number; none: number }> = {};
    for (const d of dateKeys) map[d] = { wet: 0, solid: 0, both: 0, none: 0 };

    for (const dc of diapers) {
      const key = toDateKey(dc.time);
      if (!map[key]) continue;
      map[key][dc.type]++;
    }

    return dateKeys.map((d) => ({
      date: formatDateLabel(d),
      Wet: map[d].wet,
      Solid: map[d].solid,
      Both: map[d].both,
      None: map[d].none,
    }));
  }, [diapers, days]);

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
        <XAxis dataKey="date" tick={TICK_STYLE} tickMargin={6} />
        <YAxis allowDecimals={false} tick={TICK_STYLE} width={28} />
        <Tooltip
          contentStyle={{
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 8,
          }}
        />
        <Bar dataKey="Wet" stackId="a" fill="#ffa726" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Solid" stackId="a" fill="#8d6e63" />
        <Bar dataKey="Both" stackId="a" fill="#78909c" />
        <Bar dataKey="None" stackId="a" fill="#b0bec5" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Sleep Chart ───────────────────────────────────────────────

interface SleepChartProps {
  sleeps: SleepEntry[];
  days?: number;
}

export function SleepChart({ sleeps, days = 14 }: SleepChartProps) {
  const theme = useTheme();
  const data = useMemo(() => {
    const dateKeys = lastNDays(days);
    const map: Record<string, { nap: number; night: number }> = {};
    for (const d of dateKeys) map[d] = { nap: 0, night: 0 };

    for (const s of sleeps) {
      if (!s.end_time) continue;
      const key = toDateKey(s.start_time);
      if (!map[key]) continue;
      const hours =
        (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) /
        3600000;
      if (s.is_nap) map[key].nap += hours;
      else map[key].night += hours;
    }

    return dateKeys.map((d) => ({
      date: formatDateLabel(d),
      Nap: Math.round(map[d].nap * 10) / 10,
      Night: Math.round(map[d].night * 10) / 10,
    }));
  }, [sleeps, days]);

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
        <XAxis dataKey="date" tick={TICK_STYLE} tickMargin={6} />
        <YAxis tick={TICK_STYLE} unit="h" width={32} />
        <Tooltip
          contentStyle={{
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 8,
          }}
          formatter={(value) => `${value}h`}
        />
        <Bar dataKey="Night" stackId="a" fill="#5c6bc0" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Nap" stackId="a" fill="#b39ddb" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Tummy Time Chart ─────────────────────────────────────────

interface TummyTimeChartProps {
  tummyTimes: TummyTime[];
  days?: number;
}

export function TummyTimeChart({ tummyTimes, days = 14 }: TummyTimeChartProps) {
  const theme = useTheme();
  const data = useMemo(() => {
    const dateKeys = lastNDays(days);
    const map: Record<string, number> = {};
    for (const d of dateKeys) map[d] = 0;

    for (const t of tummyTimes) {
      if (!t.end_time) continue;
      const key = toDateKey(t.start_time);
      if (!map[key] && map[key] !== 0) continue;
      const mins =
        (new Date(t.end_time).getTime() - new Date(t.start_time).getTime()) /
        60000;
      map[key] += mins;
    }

    return dateKeys.map((d) => ({
      date: formatDateLabel(d),
      Minutes: Math.round(map[d]),
    }));
  }, [tummyTimes, days]);

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
        <XAxis dataKey="date" tick={TICK_STYLE} tickMargin={6} />
        <YAxis tick={TICK_STYLE} unit="m" width={36} />
        <Tooltip
          contentStyle={{
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 8,
          }}
          formatter={(value) => `${value} min`}
        />
        <Bar dataKey="Minutes" fill="#26a69a" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Pumping Chart ─────────────────────────────────────────────

interface PumpingChartProps {
  pumpings: Pumping[];
  days?: number;
}

export function PumpingChart({ pumpings, days = 14 }: PumpingChartProps) {
  const theme = useTheme();
  // One axis, one unit — the one the app displays in, whatever unit each
  // session was logged with.
  const { unit } = useVolumeUnit();
  const data = useMemo(() => {
    const dateKeys = lastNDays(days);
    const map: Record<string, Pumping[]> = {};
    for (const d of dateKeys) map[d] = [];

    for (const p of pumpings) {
      const key = toDateKey(p.start_time);
      if (map[key]) map[key].push(p);
    }

    return dateKeys.map((d) => ({
      date: formatDateLabel(d),
      Amount: volumeTotal(map[d], unit) ?? 0,
    }));
  }, [pumpings, days, unit]);

  const unitText = unitLabel(unit);

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
        <XAxis dataKey="date" tick={TICK_STYLE} tickMargin={6} />
        <YAxis tick={TICK_STYLE} unit={unitText} width={36} />
        <Tooltip
          contentStyle={{
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 8,
          }}
          formatter={(value) => `${value} ${unitText}`}
        />
        <Bar dataKey="Amount" fill="#ec407a" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Growth Chart ──────────────────────────────────────────────

interface GrowthChartProps {
  growths: Growth[];
}

export function GrowthChart({ growths }: GrowthChartProps) {
  const theme = useTheme();
  const data = useMemo(() => {
    const sorted = [...growths].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    return sorted.map((g) => ({
      date: formatDateLabel(g.date),
      Weight: g.weight ?? undefined,
      Height: g.height ?? undefined,
      "Head Circ.": g.head_circumference ?? undefined,
    }));
  }, [growths]);

  if (data.length === 0) return null;

  const hasWeight = data.some((d) => d.Weight !== undefined);
  const hasHeight = data.some((d) => d.Height !== undefined);
  const hasHead = data.some((d) => d["Head Circ."] !== undefined);

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <LineChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
        <XAxis dataKey="date" tick={TICK_STYLE} tickMargin={6} />
        <YAxis tick={TICK_STYLE} width={32} />
        <Tooltip
          contentStyle={{
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 8,
          }}
        />
        {hasWeight && (
          <Line
            type="monotone"
            dataKey="Weight"
            stroke="#ef5350"
            strokeWidth={2}
            dot={{ r: 4 }}
            connectNulls
          />
        )}
        {hasHeight && (
          <Line
            type="monotone"
            dataKey="Height"
            stroke="#42a5f5"
            strokeWidth={2}
            dot={{ r: 4 }}
            connectNulls
          />
        )}
        {hasHead && (
          <Line
            type="monotone"
            dataKey="Head Circ."
            stroke="#66bb6a"
            strokeWidth={2}
            dot={{ r: 4 }}
            connectNulls
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
