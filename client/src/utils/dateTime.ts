/**
 * Converts a UTC ISO 8601 timestamp to a local datetime string suitable
 * for use as the value of an <input type="datetime-local"> element
 * (format: "YYYY-MM-DDTHH:MM" in the user's local timezone).
 */
export function isoToLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
