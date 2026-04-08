import { Alert, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useChildren } from "../hooks/useChildren";

export default function NoChildSelected() {
  const { children } = useChildren();
  const navigate = useNavigate();
  const hasChildren = children.length > 0;

  return (
    <Alert
      severity="warning"
      action={
        <Button color="inherit" size="small" onClick={() => navigate("/children")}>
          {hasChildren ? "Select Child" : "Add Child"}
        </Button>
      }
    >
      {hasChildren
        ? "No child selected. Please select a child to continue."
        : "No children added yet. Please add a child to get started."}
    </Alert>
  );
}
