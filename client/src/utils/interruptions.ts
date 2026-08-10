/**
 * Is the user in the middle of something that must not be interrupted?
 *
 * Reloading the page — or churning every list underneath an open dialog —
 * throws away whatever has been typed. This app gets used one-handed, mid-feed,
 * so losing a half-filled form is a real cost. Both the service-worker update
 * reload and the on-focus refetch check this before doing anything disruptive.
 *
 * It's deliberately a DOM-level question rather than a flag each dialog has to
 * register: any open modal or focused field counts, so pages added later are
 * covered without opting in.
 */
export function isUserBusy(): boolean {
  if (typeof document === "undefined") return false;

  // MUI's Dialog puts role="dialog" on its paper. Layout's bottom "Log" sheet
  // is hand-rolled and has to set the role itself — it went without one for a
  // while, and refreshes fired straight through it, rebuilding the page under
  // an open sheet. Anything modal added later needs the same.
  //
  // Presence of the role is not enough on its own: `SwipeableDrawer` keeps its
  // paper mounted while closed so the open gesture has something to drag, and
  // that paper carries role="dialog" the whole time. Matching on the role
  // alone therefore made this function return true permanently — the nav
  // drawer is part of every screen — which silently disabled every refresh
  // that consults it, and the deferred update reload with them.
  //
  // A closed modal is marked `aria-hidden` (MUI puts it on the Modal root
  // around the paper), which is precisely the "not presented to the user"
  // signal wanted here, and it needs no layout to read.
  for (const dialog of document.querySelectorAll('[role="dialog"]')) {
    if (!dialog.closest('[aria-hidden="true"]')) return true;
  }

  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  if (active.isContentEditable) return true;

  // A focused field still counts when the window itself is blurred: tapping a
  // datetime input on iOS hands focus to the native picker, which is exactly
  // the moment we must not pull the rug out.
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
