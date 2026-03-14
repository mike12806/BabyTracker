import { createChildScopedCrud } from "./crud.js";

export const sleep = createChildScopedCrud({
  table: "sleep",
  columns: ["start_time", "end_time", "is_nap", "notes"],
  requiredColumns: ["start_time"],
  orderBy: "start_time",
});
