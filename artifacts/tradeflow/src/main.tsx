import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";
import { ErrorBoundary } from "./components/ErrorBoundary";

// When deployed as a separate static site (e.g. Render), set VITE_API_URL to
// the full URL of the API service (e.g. https://tradeflow-api.onrender.com).
// In development / single-origin deployments this is left unset and relative
// /api/... paths are used automatically.
const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
if (apiUrl) {
  setBaseUrl(apiUrl);
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
