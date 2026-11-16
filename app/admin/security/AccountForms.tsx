"use client";

import { useActionState } from "react";
import { changePassword, regenerateRecoveryCodes, type AccountState } from "./actions";

const initial: AccountState = {};

export function Result({ state }: { state: { ok?: string; error?: string } }) {
  if (state.error) {
    return (
      <div className="error-summary" role="alert">
        <p className="font-medium">{state.error}</p>
      </div>
    );
  }
  return state.ok ? (
    <div className="admin-notice" role="status">
      <p className="font-medium">{state.ok}</p>
    </div>
  ) : null;
}

/** Current password and a fresh code: required for sensitive changes. */
export function ConfirmIdentityFields({ idPrefix }: { idPrefix: string }) {
  return (
    <fieldset className="admin-confirm">
      <legend>Confirm it is you</legend>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="field">
          <label htmlFor={`${idPrefix}-current`}>Current password</label>
          <input id={`${idPrefix}-current`} name="currentPassword" type="password" className="input" autoComplete="current-password" required />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-code`}>Authenticator code</label>
          <input id={`${idPrefix}-code`} name="confirmCode" className="input" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required />
        </div>
      </div>
    </fieldset>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, initial);
  return (
    <form action={action} className="grid gap-6">
      <Result state={state} />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <span className="field__help">At least 12 characters.</span>
          <input id="new-password" name="newPassword" type="password" className="input" autoComplete="new-password" required minLength={12} />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Repeat the new password</label>
          <input id="confirm-password" name="confirmPassword" type="password" className="input" autoComplete="new-password" required minLength={12} />
        </div>
      </div>
      <ConfirmIdentityFields idPrefix="pw" />
      <p>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Change password"}
        </button>
      </p>
    </form>
  );
}

export function RecoveryCodesForm() {
  const [state, action, pending] = useActionState(regenerateRecoveryCodes, initial);
  return (
    <form action={action} className="grid gap-6">
      <Result state={state} />
      {state.recoveryCodes ? (
        <ul className="admin-codes">
          {state.recoveryCodes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
      ) : null}
      <ConfirmIdentityFields idPrefix="rc" />
      <p>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? "Creating…" : "Create new recovery codes"}
        </button>
      </p>
    </form>
  );
}
