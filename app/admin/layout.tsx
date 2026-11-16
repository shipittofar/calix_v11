import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { adminProblems } from "@/lib/admin/config";
import { currentAdmin } from "@/lib/admin/session";
import { signOut } from "./login/actions";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s — CALIX admin" },
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * Admin shell. The public header and footer (rendered by the root layout) are hidden on admin
 * pages by `body:has([data-admin-shell])` in app/components.css. The root layout already supplies <main>.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const problems = await adminProblems();
  const session = problems.length ? null : await currentAdmin();
  return (
    <div data-admin-shell className="admin-shell container-calix">
      <header className="admin-header">
        <p className="type-label">CALIX admin</p>
        {session ? (
          <>
            <nav aria-label="Admin">
              <ul className="admin-nav">
                <li>
                  <Link href="/admin">General settings</Link>
                </li>
                <li>
                  <Link href="/admin/notifications">Contact form and notifications</Link>
                </li>
                <li>
                  <Link href="/admin/status">System status</Link>
                </li>
                <li>
                  <Link href="/admin/security">Account and security</Link>
                </li>
              </ul>
            </nav>
            <form action={signOut}>
              <button type="submit" className="btn btn-secondary btn-compact">
                Sign out
              </button>
            </form>
          </>
        ) : null}
      </header>
      <div className="admin-main">
        {problems.length ? (
          <section className="grid gap-4">
            <h1 className="text-[34px]">Admin unavailable</h1>
            {/* What is missing is written to the server log only (lib/admin/config.ts), not shown to visitors. */}
            <p>The admin is switched off until the server configuration is complete. The site operator can see what is missing in the server log.</p>
            <p className="type-small text-secondary">The public website is not affected.</p>
          </section>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
