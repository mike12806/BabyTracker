import { useNavigate } from "react-router-dom";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import ChildCareIcon from "@mui/icons-material/ChildCare";
import { useChildren } from "../hooks/useChildren";

export default function NoChildPlaceholder() {
  const { children, loading } = useChildren();
  const navigate = useNavigate();

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (children.length === 0) {
    return (
      <Box sx={{ textAlign: "center", mt: 8 }}>
        <ChildCareIcon sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
        <Typography variant="h5" gutterBottom>
          No children added yet
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Add a child to start tracking.
        </Typography>
        <Button variant="contained" onClick={() => navigate("/children")}>
          Add a Child
        </Button>
      </Box>
    );
  }

  return (
    <Typography color="text.secondary">Select a child from the sidebar.</Typography>
  );
}
