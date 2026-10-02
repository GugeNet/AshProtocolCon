import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AshTerminal } from "./components/ash-terminal";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root was not found.");
}

createRoot(root).render(
  <StrictMode>
    <AshTerminal />
  </StrictMode>,
);
