import type { CategoryKey } from "../theme/categoryColors";

/**
 * Where a logged entry lives: the section page that owns it and the API
 * resource its records are served from. Tapping an entry in a cross-cutting
 * view (dashboard, activity feed) sends the user to that page with the entry's
 * edit form already open — see `useEditEntryParam`.
 */
export interface ActivityTarget {
  /** Route of the section page that lists this kind of entry. */
  path: string;
  /** API resource path segment, e.g. `diaper-changes` for `/api/diaper-changes/:id`. */
  resource: string;
}

const TARGETS: Partial<Record<CategoryKey, ActivityTarget>> = {
  feed: { path: "/feedings", resource: "feedings" },
  diaper: { path: "/diapers", resource: "diaper-changes" },
  sleep: { path: "/sleep", resource: "sleep" },
  pump: { path: "/pumping", resource: "pumping" },
  tummy: { path: "/tummy-time", resource: "tummy-time" },
  temp: { path: "/temperature", resource: "temperature" },
  med: { path: "/medications", resource: "medications" },
  note: { path: "/notes", resource: "notes" },
};

/** Query param that tells a section page to open an entry in edit mode. */
export const EDIT_PARAM = "edit";

export function activityTarget(cat: CategoryKey): ActivityTarget | null {
  return TARGETS[cat] ?? null;
}

/** Build the route that opens `id` in edit mode on its section page. */
export function editEntryPath(cat: CategoryKey, id: number): string | null {
  const target = activityTarget(cat);
  return target ? `${target.path}?${EDIT_PARAM}=${id}` : null;
}
