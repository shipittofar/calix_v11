import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/session";
import { readStore } from "@/lib/settings/store";
import { EXTRA_PHONES, PROFILE_ROWS, platformOptions, valuesFrom } from "@/lib/settings/general-form";
import { GeneralForm } from "./GeneralForm";

export const metadata: Metadata = { title: "General settings" };
export const dynamic = "force-dynamic";

export default async function GeneralSettingsPage() {
  await requireAdmin("page");
  const file = await readStore("settings");
  return (
    <section className="grid gap-8">
      <div className="grid gap-4">
        <h1 className="text-[34px]">General settings</h1>
        <p>
          Company and contact details shown across the website. Saving publishes them straight away: every page shows the
          new details on its next visit. <Link href="/" className="link">View the site</Link>
        </p>
        {file ? (
          <p className="type-small text-secondary">
            Last saved {new Date(file.updatedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC.
          </p>
        ) : null}
      </div>
      <GeneralForm
        initialValues={valuesFrom(file)}
        revision={file?.revision ?? 0}
        platforms={platformOptions}
        extraPhones={EXTRA_PHONES}
        profileRows={PROFILE_ROWS}
      />
    </section>
  );
}
