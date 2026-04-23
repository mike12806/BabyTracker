import { createChildScopedCrud } from "./crud.js";

export const medications = createChildScopedCrud({
  table: "medications",
  columns: ["time", "name", "dosage", "dosage_unit", "notes"],
  requiredColumns: ["time", "name"],
  orderBy: "time",
});
