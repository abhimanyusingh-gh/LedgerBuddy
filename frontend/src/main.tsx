import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/App";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { QueryProvider } from "@/lib/query/QueryProvider";
import "@/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryProvider>
        <App />
      </QueryProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
