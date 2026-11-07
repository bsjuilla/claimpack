import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./grid";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
