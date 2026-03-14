import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    primary: {
      main: "#5c6bc0", // Indigo-ish — friendly for a baby app
    },
    secondary: {
      main: "#ef5350",
    },
    background: {
      default: "#f5f5f5",
    },
  },
  typography: {
    fontFamily: "'Roboto', 'Helvetica', 'Arial', sans-serif",
  },
  shape: {
    borderRadius: 12,
  },
});

export default theme;
