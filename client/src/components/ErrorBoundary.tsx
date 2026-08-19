import { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";

/**
 * Catches a render error and shows it, instead of letting React unmount the
 * tree and leave a blank page.
 *
 * Without one of these, any throw anywhere takes the whole app down to a white
 * screen with nothing on it: no message on the device, nothing in a log, and —
 * because an installed PWA can sit several builds behind — no way to tell a
 * bug that is still shipping from one that was fixed a week ago. The first
 * round of this was a hook-order violation on the section pages, and the only
 * evidence available was "the screen goes white".
 *
 * The build id is on screen deliberately. It is the first thing worth knowing
 * when a crash is reported, and the one thing that is impossible to recover
 * afterwards.
 */
interface Props {
  children: ReactNode;
  /** Shown above the error; defaults to the whole-app wording. */
  scope?: string;
}

interface State {
  error: Error | null;
  /** Set once an automatic reload has been triggered for a chunk-load failure. */
  reloading: boolean;
}

/**
 * A lazy route chunk from a build that's no longer served. Each page is
 * `React.lazy`-loaded (see `App.tsx`), and a device can still be showing the
 * app shell from a build whose JS chunks were deleted from the server by a
 * later deploy — the fetch for the chunk 404s, the server answers with the
 * SPA's `index.html` fallback instead, and the browser refuses to run HTML as
 * a module. Every engine phrases that refusal differently, hence the list.
 *
 * This is not a bug in the page that failed to load — the fix is just to
 * fetch the current `index.html`, which is what a reload does. Unlike the
 * service worker's `onNeedReload` signal (deferred until it can't cost
 * anyone a half-typed form, see `deferredReload.ts`), this page is already
 * blank/crashed, so there is nothing a reload could still destroy.
 */
const CHUNK_LOAD_ERROR_PATTERN =
  /dynamically imported module|error loading dynamically imported module|importing a module script failed|is not a valid javascript mime type/i;

/** sessionStorage key: the build id we last auto-reloaded for a chunk-load failure. */
const CHUNK_RELOAD_KEY = "chunkReloadBuild";

function isChunkLoadError(error: Error): boolean {
  return CHUNK_LOAD_ERROR_PATTERN.test(error.message);
}

/**
 * Whether it's worth reloading for this error: only once per build. If the
 * reload already happened for the build currently running and the same class
 * of error came right back, reloading again would just loop forever (a
 * persistent deploy problem, or no network at all) — fall through to the
 * manual "Reload" button instead.
 */
function shouldAutoReloadForChunkError(): boolean {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === __BUILD_ID__) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, __BUILD_ID__);
    return true;
  } catch {
    // Private browsing / storage disabled: can't remember we've already
    // tried, so don't risk looping.
    return false;
  }
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, reloading: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nothing collects these centrally yet, so the console is the only record
    // there is. Keep the component stack — it is what names the culprit.
    console.error("Unhandled render error", error, info.componentStack);

    if (isChunkLoadError(error) && shouldAutoReloadForChunkError()) {
      // Skip the alarming crash card for a case that isn't really a crash —
      // just an app shell fetching a chunk out from under it. The reload
      // navigates away, so this state never has to be unwound.
      this.setState({ reloading: true });
      window.location.reload();
    }
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;

    if (reloading) {
      return (
        <Box sx={{ p: 3, maxWidth: 680, mx: "auto", textAlign: "center" }}>
          <Typography color="text.secondary">Updating to the latest version…</Typography>
        </Box>
      );
    }

    return (
      <Box sx={{ p: 3, maxWidth: 680, mx: "auto", textAlign: "center" }}>
        <ReportProblemOutlinedIcon sx={{ fontSize: 56, color: "warning.main", mb: 1.5 }} />
        <Typography variant="h6" sx={{ mb: 1 }}>
          {this.props.scope ?? "Something went wrong"}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          The screen below this point failed to render. Nothing you have logged
          is affected.
        </Typography>

        <Box
          component="pre"
          sx={{
            textAlign: "left",
            p: 1.5,
            mb: 2,
            borderRadius: 2,
            bgcolor: "action.hover",
            border: 1,
            borderColor: "divider",
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowX: "auto",
          }}
        >
          {error.message || String(error)}
        </Box>

        <Stack direction="row" spacing={1} sx={{ justifyContent: "center", mb: 2 }}>
          <Button variant="contained" onClick={this.handleReload}>
            Reload
          </Button>
        </Stack>

        <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
          Build {__BUILD_ID__} · {new Date(__BUILD_TIME__).toLocaleString()}
        </Typography>
      </Box>
    );
  }
}
