import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  TextField,
  Stack,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NoChildPlaceholder from "../components/NoChildPlaceholder";

interface ActivityEntry {
  activity_type: string;
  event_time: string;
  detail: string;
  child_name: string;
  logged_by: string;
}

interface ActivityResponse {
  total: number;
  offset: number;
  limit: number;
  results: ActivityEntry[];
}

const PAGE_SIZE = 50;

type ChipColor =
  | "default"
  | "primary"
  | "secondary"
  | "error"
  | "info"
  | "success"
  | "warning";

const TYPE_COLORS: Record<string, ChipColor> = {
  Feeding: "primary",
  "Diaper Change": "warning",
  Sleep: "info",
  "Tummy Time": "success",
  Pumping: "secondary",
  Temperature: "error",
  Note: "default",
  Medication: "warning",
};

export default function ActivityPage() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async (childId: number, off: number) => {
    try {
      const params = new URLSearchParams({
        child_id: String(childId),
        limit: String(PAGE_SIZE),
        offset: String(off),
      });
      if (dateFrom) params.set("date_from", new Date(dateFrom).toISOString());
      if (dateTo) params.set("date_to", new Date(dateTo + "T23:59:59").toISOString());
      const data = await api.get<ActivityResponse>(`/activity?${params}`);
      setEntries(data.results);
      setTotal(data.total);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load activity.", "error");
    }
  }, [dateFrom, dateTo, notify]);

  useEffect(() => {
    if (!selectedChild) return;
    setOffset(0);
    load(selectedChild.id, 0);
  }, [selectedChild, load]);

  const handlePageChange = (newOffset: number) => {
    if (!selectedChild) return;
    setOffset(newOffset);
    load(selectedChild.id, newOffset);
  };

  const handleFilter = () => {
    if (!selectedChild) return;
    setOffset(0);
    load(selectedChild.id, 0);
  };

  const handleClearFilter = () => {
    setDateFrom("");
    setDateTo("");
  };

  useEffect(() => {
    if (!dateFrom && !dateTo && selectedChild) {
      load(selectedChild.id, 0);
    }
  }, [dateFrom, dateTo, selectedChild, load]);

  if (!selectedChild) {
    return <NoChildPlaceholder />;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">All Activity</Typography>
        <Typography variant="body2" color="text.secondary">
          {total} total {total === 1 ? "entry" : "entries"}
        </Typography>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-end" }}>
            <TextField
              label="From"
              type="date"
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <TextField
              label="To"
              type="date"
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
            <Button variant="contained" onClick={handleFilter} disabled={!dateFrom && !dateTo}>
              Filter
            </Button>
            {(dateFrom || dateTo) && (
              <Button variant="outlined" onClick={handleClearFilter}>
                Clear
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Detail</TableCell>
                  <TableCell>Logged By</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((entry, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {new Date(entry.event_time).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={entry.activity_type}
                        size="small"
                        color={TYPE_COLORS[entry.activity_type] ?? "default"}
                      />
                    </TableCell>
                    <TableCell sx={{ textTransform: "capitalize" }}>{entry.detail}</TableCell>
                    <TableCell>{entry.logged_by}</TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} align="center">
                      <Typography color="text.secondary">No activity recorded.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {totalPages > 1 && (
            <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 2, mt: 2 }}>
              <Button
                size="small"
                startIcon={<ArrowBackIcon />}
                disabled={offset === 0}
                onClick={() => handlePageChange(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Typography variant="body2">
                Page {currentPage} of {totalPages}
              </Typography>
              <Button
                size="small"
                endIcon={<ArrowForwardIcon />}
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => handlePageChange(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
