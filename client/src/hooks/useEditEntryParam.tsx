import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useNotification } from "../hooks/useNotification";
import { EDIT_PARAM } from "../utils/activityLinks";

/**
 * Open an entry's edit form when the page is opened with `?edit=<id>`.
 *
 * Tapping an entry in the dashboard or the activity feed navigates to the
 * section page that owns it, so the user lands in the right context with the
 * edit dialog already open — closing it leaves them on the full list.
 *
 * The entry is fetched by id rather than looked up in the page's own list: the
 * activity feed pages back through the entire history, so the tapped entry is
 * often older than the entries a section page loads up front.
 *
 * @param resource API resource segment, e.g. `diaper-changes`
 * @param onEdit   the page's existing edit handler
 */
export function useEditEntryParam<T>(
  resource: string,
  onEdit: (entry: T) => void,
): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const { notify } = useNotification();
  const editId = searchParams.get(EDIT_PARAM);

  // Keep the latest handler without re-running the effect: pages redefine it on
  // every render, and re-running would reopen the dialog over the user's edits.
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

  const handledId = useRef<string | null>(null);

  // Tracks the component, not the effect: dropping the `edit` param below
  // re-runs the effect, and tying the in-flight fetch to that run would cancel
  // the very request that opens the form.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!editId || handledId.current === editId) return;
    handledId.current = editId;

    // Drop the param up front so a refresh — or coming back to this page — does
    // not reopen the form. `replace` keeps the back button pointing at the view
    // the user tapped from.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(EDIT_PARAM);
        return next;
      },
      { replace: true },
    );

    (async () => {
      try {
        const entry = await api.get<T>(`/${resource}/${editId}`);
        if (mounted.current) onEditRef.current(entry);
      } catch (err) {
        if (mounted.current) {
          notify(
            err instanceof Error ? err.message : "Failed to open entry.",
            "error",
          );
        }
      }
    })();
  }, [editId, resource, setSearchParams, notify]);
}
