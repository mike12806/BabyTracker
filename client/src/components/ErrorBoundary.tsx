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
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nothing collects these centrally yet, so the console is the only record
    // there is. Keep the component stack — it is what names the culprit.
    console.error("Unhandled render error", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

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
