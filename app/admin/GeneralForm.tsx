"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { saveGeneralSettings, type GeneralState } from "./actions";
import type { GeneralValues } from "@/lib/settings/general-form";

type Option = { value: string; label: string };

const LABELS: Record<string, string> = {
  legalName: "Legal name",
  "address.street": "Street",
  "address.locality": "Town or city",
  "address.region": "County or region",
  "address.postcode": "Postcode",
  "address.country": "Country code",
  email: "Public email",
  "phone.e164": "Main phone number",
  "phone.display": "Main phone, as shown",
  replyTime: "Reply time",
  copyrightText: "Copyright line",
};
const label = (name: string) =>
  LABELS[name] ??
  name.replace(/^phone(\d)\.(\w+)$/, "Phone $1 $2").replace(/^profile(\d)\.(\w+)$/, "Profile $1 $2").replace("e164", "number");

const idOf = (name: string) => `f-${name.replace(/\./g, "-")}`;

function Field({
  name,
  values,
  errors,
  help,
  children,
  ...input
}: {
  name: string;
  values: GeneralValues;
  errors: Record<string, string>;
  help?: ReactNode;
  children?: ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = idOf(name);
  const error = errors[name];
  const described = [help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{children ?? label(name)}</label>
      {help ? (
        <span id={`${id}-help`} className="field__help">
          {help}
        </span>
      ) : null}
      <input
        id={id}
        name={name}
        className="input"
        defaultValue={values[name] ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        {...input}
      />
      {error ? (
        <span id={`${id}-error`} className="field__error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function GeneralForm({
  initialValues,
  revision,
  platforms,
  extraPhones,
  profileRows,
}: {
  initialValues: GeneralValues;
  revision: number;
  platforms: Option[];
  extraPhones: number;
  profileRows: number;
}) {
  const [state, action, pending] = useActionState<GeneralState, FormData>(saveGeneralSettings, {});
  const values = state.values ?? initialValues;
  const errors = state.errors ?? {};
  const errorNames = Object.keys(errors);
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) summary.current?.focus();
  }, [state]);
  // A new key after each save resets the inputs to the saved values.
  const formKey = `${state.revision ?? revision}-${state.error ? "e" : "s"}`;

  return (
    <form action={action} className="grid gap-12" key={formKey} noValidate>
      <input type="hidden" name="revision" value={state.revision ?? revision} />
      {state.error ? (
        <div ref={summary} tabIndex={-1} className="error-summary" role="alert">
          <p className="font-medium">{state.error}</p>
          {errorNames.length ? (
            <ul className="mt-3 list-disc pl-5 type-small">
              {errorNames.map((n) => (
                <li key={n}>
                  <a href={`#${idOf(n)}`}>
                    {label(n)}: {errors[n]}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : state.ok ? (
        <div className="admin-notice" role="status">
          <p className="font-medium">{state.ok}</p>
        </div>
      ) : null}

      <p className="type-small text-secondary">
        Leave a field empty when the detail has not been confirmed: the website then leaves it out rather than showing
        a guess.
      </p>

      <fieldset className="grid gap-6">
        <legend className="text-[26px] font-display">Company</legend>
        <Field name="legalName" values={values} errors={errors} maxLength={160} help="Shown in the footer copyright line." />
        <div className="grid gap-6 md:grid-cols-2">
          <Field name="address.street" values={values} errors={errors} maxLength={120} autoComplete="street-address" />
          <Field name="address.locality" values={values} errors={errors} maxLength={120} autoComplete="address-level2" />
          <Field name="address.region" values={values} errors={errors} maxLength={120} autoComplete="address-level1" />
          <Field name="address.postcode" values={values} errors={errors} maxLength={20} autoComplete="postal-code" />
          <Field
            name="address.country"
            values={values}
            errors={errors}
            maxLength={2}
            autoComplete="country"
            help="Two letters, for example GB. Required when any address line is filled in."
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-6">
        <legend className="text-[26px] font-display">Contact</legend>
        <Field name="email" type="email" values={values} errors={errors} maxLength={200} help="Shown on the contact page and in the footer." />
        <Field
          name="replyTime"
          values={values}
          errors={errors}
          maxLength={40}
          help={'Completes "We reply within …", for example "one working day". Only promise what the studio can keep.'}
        />
        <div className="grid gap-6 md:grid-cols-2">
          <Field name="phone.e164" type="tel" values={values} errors={errors} maxLength={20} help="International format, for example +441234567890." />
          <Field name="phone.display" values={values} errors={errors} maxLength={30} help="Optional, for example 01234 567890." />
        </div>
        {Array.from({ length: extraPhones }, (_, i) => (
          <div key={i} className="grid gap-6 md:grid-cols-3">
            <Field name={`phone${i + 1}.label`} values={values} errors={errors} maxLength={40}>
              Extra phone {i + 1}: label
            </Field>
            <Field name={`phone${i + 1}.e164`} type="tel" values={values} errors={errors} maxLength={20}>
              Number
            </Field>
            <Field name={`phone${i + 1}.display`} values={values} errors={errors} maxLength={30}>
              As shown (optional)
            </Field>
          </div>
        ))}
      </fieldset>

      <fieldset className="grid gap-6">
        <legend className="text-[26px] font-display">Social profiles</legend>
        <p className="type-small text-secondary">Listed in the footer and in the site&rsquo;s structured data, in this order.</p>
        {Array.from({ length: profileRows }, (_, i) => {
          const n = `profile${i + 1}`;
          const pid = idOf(`${n}.platform`);
          const perr = errors[`${n}.platform`];
          return (
            <div key={i} className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div className="field">
                <label htmlFor={pid}>Profile {i + 1}: platform</label>
                <select
                  id={pid}
                  name={`${n}.platform`}
                  className="input"
                  defaultValue={values[`${n}.platform`] ?? ""}
                  aria-invalid={perr ? true : undefined}
                  aria-describedby={perr ? `${pid}-error` : undefined}
                >
                  <option value="">None</option>
                  {platforms.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {perr ? (
                  <span id={`${pid}-error`} className="field__error">
                    {perr}
                  </span>
                ) : null}
              </div>
              <Field name={`${n}.url`} type="url" values={values} errors={errors} maxLength={200}>
                Address (https://…)
              </Field>
            </div>
          );
        })}
      </fieldset>

      <fieldset className="grid gap-6">
        <legend className="text-[26px] font-display">Footer</legend>
        <Field
          name="copyrightText"
          values={values}
          errors={errors}
          maxLength={120}
          help={'Optional. Replaces "© 2026 [legal name]." Write {year} for the current year, for example "© {year} CALIX Ltd. All rights reserved."'}
        />
      </fieldset>

      <p>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save and publish"}
        </button>
      </p>
    </form>
  );
}
