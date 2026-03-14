import { createChildScopedCrud } from "./crud.js";

export const pumping = createChildScopedCrud({
  table: "pumping",
  columns: ["start_time", "end_time", "amount", "amount_unit", "notes"],
  requiredColumns: ["start_time"],
  orderBy: "start_time",
});
