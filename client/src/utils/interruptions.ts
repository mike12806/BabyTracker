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

  // MUI's Dialog puts role="dialog" on its paper; Layout's bottom "Log" sheet
  // sets the same role.
  if (document.querySelector('[role="dialog"]')) return true;

  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  if (active.isContentEditable) return true;

  // A focused field still counts when the window itself is blurred: tapping a
  // datetime input on iOS hands focus to the native picker, which is exactly
  // the moment we must not pull the rug out.
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
