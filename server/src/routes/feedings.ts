import { createChildScopedCrud } from "./crud.js";

export const feedings = createChildScopedCrud({
  table: "feedings",
  columns: ["type", "start_time", "end_time", "amount", "amount_unit", "notes"],
  requiredColumns: ["type", "start_time"],
  orderBy: "start_time",
});
