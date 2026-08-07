import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./app.tsx";
import { ThemeProvider } from "./components/theme-provider.tsx";
import { RuntimeProvider } from "./runtime-provider.tsx";
import "./app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root is missing");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <RuntimeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </RuntimeProvider>
    </ThemeProvider>
  </StrictMode>,
);
