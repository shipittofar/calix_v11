import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/admin/session";
import { systemStatus, type Level } from "@/lib/admin/status";
import { RefreshForm } from "./RefreshForm";

export const metadata: Metadata = { title: "System status" };
export const dynamic = "force-dynamic";

const WORD: Record<Level, string> = { ok: "OK", warn: "Check", problem: "Problem", info: "Info" };

export default async function StatusPage() {
  await requireAdmin("page");
  const sections = await systemStatus(await headers());
  const all = sections.flatMap((s) => s.checks);
  const problems = all.filter((c) => c.level === "problem").length;
  const warnings = all.filter((c) => c.level === "warn").length;

  return (
    <div className="grid gap-12">
      <section className="grid gap-4">
        <h1 className="text-[34px]">System status</h1>
        <div className={problems ? "error-summary" : "admin-notice"} role="status">
          <p className="font-medium">
            {problems
              ? `${problems} problem${problems > 1 ? "s" : ""} need${problems > 1 ? "" : "s"} attention.`
              : warnings
                ? `No problems. ${warnings} item${warnings > 1 ? "s" : ""} to check.`
                : "Everything checked is working."}
          </p>
        </div>
        <p className="type-small text-secondary">
          Checked when this page loaded. Server settings are shown as set or not set, never with their values. The operator&rsquo;s
          runbook (docs/admin-panel-runbook.md) explains each item.
        </p>
      </section>

      {sections.map((section) => (
        <section key={section.title} className="grid gap-4" aria-labelledby={`s-${section.title}`}>
          <h2 id={`s-${section.title}`} className="text-[26px]">
            {section.title}
          </h2>
          <dl className="admin-status">
            {section.checks.map((c) => (
              <div key={c.id} className="admin-status__row" data-level={c.level}>
                <dt>{c.label}</dt>
                <dd>
                  <strong className="admin-status__level">{WORD[c.level]}</strong> {c.detail}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section aria-labelledby="refresh" className="grid gap-4">
        <h2 id="refresh" className="text-[26px]">
          Refresh public pages
        </h2>
        <p>Use this after the settings files were restored from a backup or changed outside the admin.</p>
        <RefreshForm />
      </section>
    </div>
  );
}
