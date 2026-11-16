"use client";

import { useActionState } from "react";
import { refreshPublicPages, type RefreshState } from "./actions";
import { Result } from "../security/AccountForms";

export function RefreshForm() {
  const [state, action, pending] = useActionState<RefreshState, FormData>(refreshPublicPages, {});
  return (
    <form action={action} className="grid gap-4">
      <Result state={state} />
      <p>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? "Refreshing…" : "Refresh public pages"}
        </button>
      </p>
    </form>
  );
}
