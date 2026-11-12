import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/jetbrains-mono";
import "./tokens.css";
import App from "./App";
import "./style.css";

// The webview delivers file drops to the frontend. Keep drops outside a
// designated target from replacing the workspace with the dropped file.
window.addEventListener("drop", event => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
