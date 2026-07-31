import React from "react";
import { NavLink } from "react-router-dom";

export function PermissionDenied() {
  return (
    <div className="h-full min-h-[60vh] flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-2 text-primary">Permission denied</h1>
        <p className="text-muted-foreground mb-4">
          Your current role doesn’t have access to this page.
        </p>
        <NavLink
          to="/"
          className="inline-flex items-center justify-center w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground font-medium"
        >
          Go to Home
        </NavLink>
      </div>
    </div>
  );
}
