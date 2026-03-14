import { createChildScopedCrud } from "./crud.js";

export const tummyTime = createChildScopedCrud({
  table: "tummy_time",
  columns: ["start_time", "end_time", "milestone", "notes"],
  requiredColumns: ["start_time"],
  orderBy: "start_time",
});
