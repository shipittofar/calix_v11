import "server-only";
import { randomBytes } from "node:crypto";
import { readStore, updateStore } from "@/lib/settings/store";
import type { ChannelName, DeliveryRecord, StatusFile } from "@/lib/settings/schema";
import { ALERT_WINDOW_MS } from "./alerts";

/**
 * Delivery outcomes in status.json: time, a random request ID, and each channel's result code.
 * Never enquiry content. Keeps the latest 200 records. A store problem never changes what the
 * visitor is told: it is logged and the delivery outcome stands.
 */
const KEEP = 200;

const empty = (): Omit<StatusFile, "version" | "revision" | "updatedAt" | "updatedBy"> => ({ records: [], lastTest: {}, lastAlertAt: {} });
const body = (s: StatusFile | null) => (s ? { records: s.records, lastTest: s.lastTest, lastAlertAt: s.lastAlertAt } : empty());

export const newRequestId = () => `req_${randomBytes(9).toString("base64url")}`;

export async function recordDelivery(record: DeliveryRecord): Promise<void> {
  try {
    const r = await updateStore("status", (cur) => {
      const b = body(cur);
      return { ...b, records: [...b.records, record].slice(-KEEP) };
    }, { by: "system" });
    if (!r.ok) console.error(`[delivery] could not record the outcome (${r.reason})`);
  } catch {
    console.error("[delivery] could not record the outcome");
  }
}

/** Claims the alert slot for `about` under the store lock. False if used within the window or unrecordable. */
export async function claimAlert(about: ChannelName, now: Date): Promise<boolean> {
  let claimed = false;
  try {
    const r = await updateStore("status", (cur) => {
      const b = body(cur);
      const last = b.lastAlertAt[about];
      claimed = !last || now.getTime() - Date.parse(last) >= ALERT_WINDOW_MS;
      return claimed ? { ...b, lastAlertAt: { ...b.lastAlertAt, [about]: now.toISOString() } } : b;
    }, { by: "system" });
    // Without a working store the throttle can't be enforced, so no alert is sent (no floods).
    return r.ok && claimed;
  } catch {
    return false;
  }
}

export async function recordTest(channel: ChannelName, test: StatusFile["lastTest"]["email"] & object): Promise<boolean> {
  const r = await updateStore("status", (cur) => {
    const b = body(cur);
    return { ...b, lastTest: { ...b.lastTest, [channel]: test } };
  }, { by: test.by });
  return r.ok;
}

export async function readStatus(): Promise<StatusFile | null> {
  return readStore("status");
}
