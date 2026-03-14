import { createTheme } from "@mui/material/styles";

export function buildTheme(mode: "light" | "dark") {
  return createTheme({
    palette: {
      mode,
      primary: {
        main: "#5c6bc0",
      },
      secondary: {
        main: "#ef5350",
      },
      background: mode === "light"
        ? { default: "#f5f5f5", paper: "#ffffff" }
        : { default: "#121212", paper: "#1e1e1e" },
    },
    typography: {
      fontFamily: "'Roboto', 'Helvetica', 'Arial', sans-serif",
    },
    shape: {
      borderRadius: 12,
    },
  });
}

const theme = buildTheme("light");
export default theme;
