import { createChildScopedCrud } from "./crud.js";

export const diaperChanges = createChildScopedCrud({
  table: "diaper_changes",
  columns: ["time", "type", "color", "notes"],
  requiredColumns: ["time", "type"],
  orderBy: "time",
});
