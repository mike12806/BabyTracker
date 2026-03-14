import { createChildScopedCrud } from "./crud.js";

export const temperature = createChildScopedCrud({
  table: "temperature",
  columns: ["time", "reading", "reading_unit", "notes"],
  requiredColumns: ["time", "reading"],
  orderBy: "time",
});
