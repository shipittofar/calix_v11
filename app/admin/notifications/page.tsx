import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/session";
import { readStore } from "@/lib/settings/store";
import { deliveryView } from "@/lib/delivery/admin";
import { explain } from "@/lib/delivery/codes";
import type { DeliveryRecord } from "@/lib/settings/schema";
import { DeliveryForm, FormStatusForm, TestButton } from "./NotificationForms";

export const metadata: Metadata = { title: "Contact form and notifications" };
export const dynamic = "force-dynamic";

const when = (iso?: string) => (iso ? `${new Date(iso).toLocaleString("en-GB", { timeZone: "UTC" })} UTC` : "Never");
const DAY = 24 * 60 * 60 * 1000;

type Channel = "email" | "telegram" | "whatsapp";
const CHANNELS = ["email", "telegram", "whatsapp"] as const;
const NAMES: Record<Channel, string> = { email: "Email", telegram: "Telegram", whatsapp: "WhatsApp" };

function failures(records: DeliveryRecord[], channel: Channel, sinceMs: number) {
  const since = Date.now() - sinceMs;
  return records.filter((r) => r.kind === "enquiry" && Date.parse(r.at) >= since && r.results.some((x) => x.channel === channel && x.result !== "confirmed")).length;
}

export default async function NotificationsPage() {
  await requireAdmin("page");
  const [view, settings] = await Promise.all([deliveryView(), readStore("settings")]);
  const form = settings?.form ?? { acceptingEnquiries: true };
  const enquiries = view.records.filter((r) => r.kind === "enquiry");
  const lastOf = (channel: Channel) => enquiries.find((r) => r.results.some((x) => x.channel === channel))?.results.find((x) => x.channel === channel);

  const channelRows = CHANNELS.map((channel) => {
    const c = view[channel];
    const test = view.lastTest[channel];
    const last = lastOf(channel);
    return {
      channel,
      name: NAMES[channel],
      state: !c.enabled ? "Off" : c.ready ? "On and ready" : `On but not working: ${explain(c.problem ?? "")}`,
      test: test ? `${when(test.at)}: ${explain(test.result)}` : "Never",
      last: last ? explain(last.result) : "No enquiries yet",
      day: failures(view.records, channel, DAY),
      week: failures(view.records, channel, 7 * DAY),
      alert: when(view.lastAlertAt[channel]),
    };
  });
  const noChannel = view.mode === "live" && !view.email.ready && !view.telegram.ready && !view.whatsapp.ready;

  return (
    <div className="grid gap-16">
      <section className="grid gap-4">
        <h1 className="text-[34px]">Contact form and notifications</h1>
        <p>Choose where new enquiries go, test each channel, and pause the contact form when the studio can&rsquo;t take new work.</p>
        {view.mode === "refused" || noChannel ? (
          <div className="error-summary" role="alert">
            <p className="font-medium">
              Enquiries can&rsquo;t be delivered at the moment, so visitors are told to try again later.{" "}
              {view.mode === "refused" ? explain(view.refusedBecause ?? "") : "No channel is ready."}
            </p>
          </div>
        ) : null}
        {view.mode === "log" ? <p className="type-small">This server logs enquiries instead of sending them (development or preview).</p> : null}
      </section>

      <section aria-labelledby="pause" className="grid gap-6">
        <h2 id="pause" className="text-[26px]">Contact form</h2>
        <FormStatusForm accepting={form.acceptingEnquiries} pausedMessage={form.pausedMessage ?? ""} revision={settings?.revision ?? 0} />
      </section>

      <section aria-labelledby="channels" className="grid gap-6">
        <h2 id="channels" className="text-[26px]">Delivery channels</h2>
        <p className="type-small text-secondary">
          Enquiries go to every channel that is on, at the same time. A visitor is thanked when at least one channel accepts the
          enquiry; if none does, they are asked to try again and keep what they wrote. If one channel fails, the other one alerts you
          (at most once every 30 minutes per channel).
        </p>
        <div className="admin-scroll" role="region" aria-labelledby="channels" tabIndex={0}>
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col">State</th>
                <th scope="col">Last test</th>
                <th scope="col">Last enquiry</th>
                <th scope="col">Failures (24 h / 7 days)</th>
                <th scope="col">Last alert</th>
              </tr>
            </thead>
            <tbody>
              {channelRows.map((r) => (
                <tr key={r.channel}>
                  <th scope="row">{r.name}</th>
                  <td>{r.state}</td>
                  <td>{r.test}</td>
                  <td>{r.last}</td>
                  <td>
                    {r.day} / {r.week}
                  </td>
                  <td>{r.alert}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="grid gap-2">
            <h3 className="text-[20px]">Test email</h3>
            <p className="type-small">Sends a test message, with no visitor data, to the saved recipient.</p>
            <TestButton channel="email" />
          </div>
          <div className="grid gap-2">
            <h3 className="text-[20px]">Test Telegram</h3>
            <p className="type-small">Sends a test message to the saved chat. Required before Telegram can be switched on.</p>
            <TestButton channel="telegram" />
          </div>
          <div className="grid gap-2">
            <h3 className="text-[20px]">Test WhatsApp</h3>
            <p className="type-small">Sends a test message, with no visitor data, to the saved WhatsApp number.</p>
            <TestButton channel="whatsapp" />
          </div>
        </div>
        <DeliveryForm
          revision={view.revision}
          emailEnabled={view.email.enabled}
          recipient={view.email.recipient}
          serverRecipientSet={view.email.serverDefault || Boolean(process.env.ENQUIRY_TO)}
          telegramEnabled={view.telegram.enabled}
          chatId={view.telegram.chatId}
          tokenSaved={view.telegram.tokenSaved}
          tokenSavedAt={view.telegram.tokenSavedAt}
          telegramAllowed={view.telegram.allowed}
          whatsappEnabled={view.whatsapp.enabled}
          waTo={view.whatsapp.to}
          waPhoneNumberId={view.whatsapp.phoneNumberId}
          waTemplate={view.whatsapp.template}
          waLanguage={view.whatsapp.language}
          waTokenSaved={view.whatsapp.tokenSaved}
          waTokenSavedAt={view.whatsapp.tokenSavedAt}
        />
      </section>

      <section aria-labelledby="recent" className="grid gap-4">
        <h2 id="recent" className="text-[26px]">Recent deliveries</h2>
        <p className="type-small text-secondary">The last 50 deliveries and alerts. No enquiry content is kept.</p>
        {view.records.length === 0 ? (
          <p className="type-small">Nothing yet.</p>
        ) : (
          <div className="admin-scroll" role="region" aria-labelledby="recent" tabIndex={0}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">When (UTC)</th>
                  <th scope="col">What</th>
                  <th scope="col">Email</th>
                  <th scope="col">Telegram</th>
                  <th scope="col">WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {view.records.map((r, i) => {
                  const cell = (ch: Channel) => {
                    const x = r.results.find((y) => y.channel === ch);
                    return x ? (x.result === "confirmed" ? "Delivered" : explain(x.result)) : "";
                  };
                  return (
                    <tr key={`${r.requestId}-${i}`}>
                      <td>{when(r.at)}</td>
                      <td>
                        {r.kind === "enquiry"
                          ? "Enquiry"
                          : r.skipped
                            ? `Alert about ${r.about} not sent: no channel was working`
                            : `Alert about ${r.about}`}
                      </td>
                      <td>{cell("email")}</td>
                      <td>{cell("telegram")}</td>
                      <td>{cell("whatsapp")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
