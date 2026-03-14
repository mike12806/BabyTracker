import { createChildScopedCrud } from "./crud.js";

export const notes = createChildScopedCrud({
  table: "notes",
  columns: ["time", "title", "content"],
  requiredColumns: ["time", "content"],
  orderBy: "time",
});
