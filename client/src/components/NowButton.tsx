import { Button } from "@mui/material";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function nowLocalDatetime(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface NowButtonProps {
  onSetNow: (value: string) => void;
  type?: "datetime" | "date";
}

export default function NowButton({ onSetNow, type = "datetime" }: NowButtonProps) {
  return (
    <Button
      size="small"
      variant="outlined"
      onClick={() => onSetNow(type === "date" ? todayLocalDate() : nowLocalDatetime())}
      sx={{ mt: 1, minWidth: "auto", px: 1.25, whiteSpace: "nowrap", flexShrink: 0 }}
    >
      {type === "date" ? "Today" : "Now"}
    </Button>
  );
}
