"use client";

import Link from "next/link";
import { useActionState } from "react";
import { completeEnrolment, signIn, verifyCode, type LoginState } from "./actions";

const initial: LoginState = {};

function Problem({ state }: { state: LoginState }) {
  return state.error ? (
    <div className="error-summary" role="alert">
      <p className="font-medium">{state.error}</p>
    </div>
  ) : null;
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(signIn, initial);
  return (
    <form action={action} className="grid gap-6 max-w-[28rem]">
      <Problem state={state} />
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" className="input" autoComplete="username" required maxLength={200} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required maxLength={200} />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

export function CodeForm() {
  const [state, action, pending] = useActionState(verifyCode, initial);
  return (
    <form action={action} className="grid gap-6 max-w-[28rem]">
      <Problem state={state} />
      <div className="field">
        <label htmlFor="code">Authenticator code</label>
        <span id="code-help" className="field__help">
          The 6-digit code from your authenticator app, or one of your recovery codes.
        </span>
        <input id="code" name="code" className="input" autoComplete="one-time-code" inputMode="text" required maxLength={20} aria-describedby="code-help" />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}

function QrCode({ modules }: { modules: boolean[][] }) {
  const n = modules.length;
  const quiet = 4;
  const d = modules.flatMap((row, r) => row.map((on, c) => (on ? `M${c + quiet} ${r + quiet}h1v1h-1z` : ""))).join("");
  return (
    <svg viewBox={`0 0 ${n + quiet * 2} ${n + quiet * 2}`} role="img" aria-label="QR code for the authenticator app" width={220} height={220} shapeRendering="crispEdges">
      <rect width="100%" height="100%" fill="white" />
      <path d={d} fill="black" />
    </svg>
  );
}

export function EnrolForm({ secret, uri, qr }: { secret: string | null; uri: string | null; qr: boolean[][] | null }) {
  const [state, action, pending] = useActionState(completeEnrolment, initial);
  if (state.recoveryCodes) {
    return (
      <div className="grid gap-6 max-w-[36rem]">
        <div className="admin-notice" role="status">
          <p className="font-medium">Authenticator set up. You are signed in.</p>
        </div>
        <h2 className="text-[26px]">Your recovery codes</h2>
        <p className="type-small">
          Each code signs you in once if you lose your phone. Store them somewhere safe now: they are not shown again.
        </p>
        <ul className="admin-codes">
          {state.recoveryCodes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <p>
          <Link href="/admin" className="btn btn-primary">
            I have saved them, continue
          </Link>
        </p>
      </div>
    );
  }
  if (!secret || !uri) {
    return (
      <p>
        <Link href="/admin" className="link">
          Continue to the admin
        </Link>
      </p>
    );
  }
  return (
    <form action={action} className="grid gap-6 max-w-[36rem]">
      <Problem state={state} />
      <p>Add this account to an authenticator app (for example 1Password, Google Authenticator or Microsoft Authenticator):</p>
      {qr ? (
        <div>
          <QrCode modules={qr} />
          <p className="type-small mt-2">Scan this code with the app, or use the setup key below.</p>
        </div>
      ) : null}
      <dl className="admin-dl">
        <dt>Setup key</dt>
        <dd>
          <code className="admin-secret">{secret.replace(/(.{4})/g, "$1 ").trim()}</code>
        </dd>
        <dt>Or this link, on the phone</dt>
        <dd>
          <a href={uri} className="link break-all">
            Add to authenticator
          </a>
        </dd>
      </dl>
      <div className="field">
        <label htmlFor="code">Code shown by the app</label>
        <input id="code" name="code" className="input" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Checking…" : "Confirm and sign in"}
      </button>
    </form>
  );
}
