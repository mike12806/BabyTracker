import { createChildScopedCrud } from "./crud.js";

export const growth = createChildScopedCrud({
  table: "growth",
  columns: ["date", "weight", "weight_unit", "height", "height_unit", "head_circumference", "head_circumference_unit", "notes"],
  requiredColumns: ["date"],
  orderBy: "date",
});
