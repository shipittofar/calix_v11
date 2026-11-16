"use client";

import { useActionState } from "react";
import { saveDelivery, saveFormStatus, testEmail, testTelegram, testWhatsapp, type DeliveryState, type FormStatusState, type TestState } from "./actions";
import { ConfirmIdentityFields, Result } from "../security/AccountForms";

function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? (
    <span id={`${id}-error`} className="field__error">
      {error}
    </span>
  ) : null;
}

export function FormStatusForm({ accepting, pausedMessage, revision }: { accepting: boolean; pausedMessage: string; revision: number }) {
  const [state, action, pending] = useActionState<FormStatusState, FormData>(saveFormStatus, {});
  const v = state.values ?? { accepting, pausedMessage };
  const err = state.errors?.pausedMessage;
  return (
    <form action={action} className="grid gap-6" key={`${revision}-${state.ok ?? ""}`}>
      <input type="hidden" name="revision" value={revision} />
      <Result state={state} />
      <fieldset className="field grid gap-2">
        <legend>Enquiries</legend>
        <label className="choice">
          <input type="radio" name="accepting" value="yes" defaultChecked={v.accepting} /> Open: the contact form is shown
        </label>
        <label className="choice">
          <input type="radio" name="accepting" value="no" defaultChecked={!v.accepting} /> Paused: visitors see the message below instead
        </label>
      </fieldset>
      <div className="field">
        <label htmlFor="paused-message">Message while paused</label>
        <span id="paused-message-help" className="field__help">
          Required when paused. Say when enquiries reopen and how to reach the studio meanwhile. Up to 300 characters.
        </span>
        <textarea
          id="paused-message"
          name="pausedMessage"
          className="input"
          maxLength={300}
          rows={3}
          defaultValue={v.pausedMessage}
          aria-invalid={err ? true : undefined}
          aria-describedby={`paused-message-help${err ? " paused-message-error" : ""}`}
        />
        <FieldError id="paused-message" error={err} />
      </div>
      <p>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </p>
    </form>
  );
}

export type DeliveryFormProps = {
  revision: number;
  emailEnabled: boolean;
  recipient: string;
  serverRecipientSet: boolean;
  telegramEnabled: boolean;
  chatId: string;
  tokenSaved: boolean;
  tokenSavedAt?: string;
  telegramAllowed: boolean;
  whatsappEnabled: boolean;
  waTo: string;
  waPhoneNumberId: string;
  waTemplate: string;
  waLanguage: string;
  waTokenSaved: boolean;
  waTokenSavedAt?: string;
};

export function DeliveryForm(p: DeliveryFormProps) {
  const [state, action, pending] = useActionState<DeliveryState, FormData>(saveDelivery, {});
  const v = state.values ?? {
    emailEnabled: p.emailEnabled,
    recipient: p.recipient,
    telegramEnabled: p.telegramEnabled,
    chatId: p.chatId,
    whatsappEnabled: p.whatsappEnabled,
    waTo: p.waTo,
    waPhoneNumberId: p.waPhoneNumberId,
    waTemplate: p.waTemplate,
    waLanguage: p.waLanguage,
  };
  const e = state.errors ?? {};
  const desc = (id: string, help = false) => [help ? `${id}-help` : "", e[id] ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <form action={action} className="grid gap-8" key={`${p.revision}-${state.ok ?? ""}`} autoComplete="off">
      <input type="hidden" name="revision" value={p.revision} />
      <Result state={state} />

      <fieldset className="grid gap-4">
        <legend className="text-[22px] font-display">Email</legend>
        <label className="choice">
          <input type="checkbox" name="emailEnabled" defaultChecked={v.emailEnabled} aria-describedby={desc("emailEnabled")} /> Send enquiries by email
        </label>
        <FieldError id="emailEnabled" error={e.emailEnabled} />
        <div className="field">
          <label htmlFor="recipient">Recipient address</label>
          <span id="recipient-help" className="field__help">
            {p.serverRecipientSet ? "Leave empty to use the address set on the server (ENQUIRY_TO)." : "No address is set on the server, so enter one."}
          </span>
          <input id="recipient" name="recipient" type="email" className="input" defaultValue={v.recipient} maxLength={200} aria-invalid={e.recipient ? true : undefined} aria-describedby={desc("recipient", true)} />
          <FieldError id="recipient" error={e.recipient} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="text-[22px] font-display">Telegram</legend>
        {!p.telegramAllowed ? (
          <p className="type-small">
            Telegram can&rsquo;t be switched on yet: it becomes a recipient of visitors&rsquo; personal data. The server operator sets
            TELEGRAM_DELIVERY_ALLOWED=true once the privacy notice has been updated and the setup has been checked. You can already save
            the bot and send test messages.
          </p>
        ) : null}
        <label className="choice">
          <input type="checkbox" name="telegramEnabled" defaultChecked={v.telegramEnabled} aria-describedby={desc("telegramEnabled")} /> Send enquiries to Telegram
        </label>
        <FieldError id="telegramEnabled" error={e.telegramEnabled} />
        <div className="field">
          <label htmlFor="chatId">Chat ID</label>
          <span id="chatId-help" className="field__help">A private group or chat for CALIX staff only, for example -1001234567890.</span>
          <input id="chatId" name="chatId" className="input" defaultValue={v.chatId} maxLength={40} aria-invalid={e.chatId ? true : undefined} aria-describedby={desc("chatId", true)} />
          <FieldError id="chatId" error={e.chatId} />
        </div>
        <div className="field">
          <label htmlFor="botToken">{p.tokenSaved ? "Replace the bot token" : "Bot token"}</label>
          <span id="botToken-help" className="field__help">
            {p.tokenSaved
              ? `A token is saved${p.tokenSavedAt ? ` (since ${new Date(p.tokenSavedAt).toLocaleDateString("en-GB", { timeZone: "UTC" })})` : ""}. It is stored encrypted and never shown. Leave empty to keep it.`
              : "From @BotFather. Stored encrypted; it is never shown again."}
          </span>
          <input id="botToken" name="botToken" type="password" className="input" autoComplete="off" spellCheck={false} maxLength={200} aria-invalid={e.botToken ? true : undefined} aria-describedby={desc("botToken", true)} />
          <FieldError id="botToken" error={e.botToken} />
        </div>
        {p.tokenSaved ? (
          <label className="choice">
            <input type="checkbox" name="removeToken" /> Remove the saved token (switches Telegram off)
          </label>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="text-[22px] font-display">WhatsApp</legend>
        <p className="type-small">
          Sends each enquiry to the number below through the WhatsApp Business Cloud API (Meta). Create an app at developers.facebook.com,
          add the WhatsApp product, and copy the Phone number ID and a permanent access token. Enquiries contain visitors&rsquo; personal
          data, so name WhatsApp (Meta) as a recipient in the privacy notice.
        </p>
        <label className="choice">
          <input type="checkbox" name="whatsappEnabled" defaultChecked={v.whatsappEnabled} aria-describedby={desc("whatsappEnabled")} /> Send enquiries to WhatsApp
        </label>
        <FieldError id="whatsappEnabled" error={e.whatsappEnabled} />
        <div className="field">
          <label htmlFor="waTo">WhatsApp number that receives enquiries</label>
          <span id="waTo-help" className="field__help">International format with country code, for example +491701234567.</span>
          <input id="waTo" name="waTo" type="tel" inputMode="tel" className="input" defaultValue={v.waTo} maxLength={20} aria-invalid={e.waTo ? true : undefined} aria-describedby={desc("waTo", true)} />
          <FieldError id="waTo" error={e.waTo} />
        </div>
        <div className="field">
          <label htmlFor="waPhoneNumberId">Phone number ID</label>
          <span id="waPhoneNumberId-help" className="field__help">The sending number in Meta (WhatsApp &gt; API setup). Digits only.</span>
          <input id="waPhoneNumberId" name="waPhoneNumberId" inputMode="numeric" className="input" defaultValue={v.waPhoneNumberId} maxLength={30} aria-invalid={e.waPhoneNumberId ? true : undefined} aria-describedby={desc("waPhoneNumberId", true)} />
          <FieldError id="waPhoneNumberId" error={e.waPhoneNumberId} />
        </div>
        <div className="field">
          <label htmlFor="waAccessToken">{p.waTokenSaved ? "Replace the access token" : "Access token"}</label>
          <span id="waAccessToken-help" className="field__help">
            {p.waTokenSaved
              ? `A token is saved${p.waTokenSavedAt ? ` (since ${new Date(p.waTokenSavedAt).toLocaleDateString("en-GB", { timeZone: "UTC" })})` : ""}. It is stored encrypted and never shown. Leave empty to keep it.`
              : "A permanent token from a Meta system user. Stored encrypted; it is never shown again."}
          </span>
          <input id="waAccessToken" name="waAccessToken" type="password" className="input" autoComplete="off" spellCheck={false} maxLength={700} aria-invalid={e.waAccessToken ? true : undefined} aria-describedby={desc("waAccessToken", true)} />
          <FieldError id="waAccessToken" error={e.waAccessToken} />
        </div>
        {p.waTokenSaved ? (
          <label className="choice">
            <input type="checkbox" name="removeWaToken" /> Remove the saved token (switches WhatsApp off)
          </label>
        ) : null}
        <div className="field">
          <label htmlFor="waTemplate">Message template name (recommended)</label>
          <span id="waTemplate-help" className="field__help">
            An approved template whose body is a single variable, for example &ldquo;{"{{1}}"}&rdquo;. Needed for WhatsApp to deliver to a number
            that has not messaged the sender in the last 24 hours. Leave empty to send plain text (works only inside that window).
          </span>
          <input id="waTemplate" name="waTemplate" className="input" defaultValue={v.waTemplate} maxLength={100} aria-invalid={e.waTemplate ? true : undefined} aria-describedby={desc("waTemplate", true)} />
          <FieldError id="waTemplate" error={e.waTemplate} />
        </div>
        <div className="field">
          <label htmlFor="waLanguage">Template language</label>
          <span id="waLanguage-help" className="field__help">Language code of the template, for example en or en_US. Defaults to en.</span>
          <input id="waLanguage" name="waLanguage" className="input" defaultValue={v.waLanguage} maxLength={10} aria-invalid={e.waLanguage ? true : undefined} aria-describedby={desc("waLanguage", true)} />
          <FieldError id="waLanguage" error={e.waLanguage} />
        </div>
      </fieldset>

      <ConfirmIdentityFields idPrefix="dl" />
      <p>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save channels"}
        </button>
      </p>
    </form>
  );
}

export function TestButton({ channel }: { channel: "email" | "telegram" | "whatsapp" }) {
  const [state, action, pending] = useActionState<TestState, FormData>(
    channel === "email" ? testEmail : channel === "telegram" ? testTelegram : testWhatsapp,
    {},
  );
  return (
    <form action={action} className="grid gap-3">
      <p>
        <button type="submit" className="btn btn-secondary btn-compact" disabled={pending}>
          {pending ? "Sending…" : channel === "email" ? "Send test email" : "Send test message"}
        </button>
      </p>
      {state.error || state.message ? (
        <p role={state.result === "confirmed" ? "status" : "alert"} className="type-small font-medium">
          {state.error ?? state.message}
        </p>
      ) : null}
    </form>
  );
}
