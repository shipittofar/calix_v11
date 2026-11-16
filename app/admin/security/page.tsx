import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/session";
import { listAdmins } from "@/lib/admin/users";
import { recentAudit } from "@/lib/admin/audit";
import { ChangePasswordForm, RecoveryCodesForm } from "./AccountForms";
import { signOutEverywhere } from "./actions";

export const metadata: Metadata = { title: "Account and security" };
export const dynamic = "force-dynamic";

const when = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"
    : "Never";

export default async function SecurityPage() {
  const { admin } = await requireAdmin("page");
  const [admins, audit] = await Promise.all([listAdmins(), recentAudit(50)]);

  return (
    <div className="grid gap-16">
      <section className="grid gap-6">
        <h1 className="text-[34px]">Account and security</h1>
        <p className="type-small text-secondary">Signed in as {admin.email}.</p>
      </section>

      <section aria-labelledby="pw" className="grid gap-6">
        <h2 id="pw" className="text-[26px]">
          Change your password
        </h2>
        <ChangePasswordForm />
      </section>

      <section aria-labelledby="rc" className="grid gap-6">
        <h2 id="rc" className="text-[26px]">
          Recovery codes
        </h2>
        <p className="type-small">
          {admin.recoveryCodes.length} unused recovery codes left.
        </p>
        <RecoveryCodesForm />
      </section>

      <section aria-labelledby="sessions" className="grid gap-4">
        <h2 id="sessions" className="text-[26px]">
          Sessions
        </h2>
        <form action={signOutEverywhere}>
          <button type="submit" className="btn btn-secondary">
            Sign out on every device
          </button>
        </form>
      </section>

      <section aria-labelledby="admins" className="grid gap-4">
        <h2 id="admins" className="text-[26px]">
          Administrators
        </h2>
        <p className="type-small text-secondary">
          Accounts are added, reset and disabled on the server with{" "}
          <code>npm run admin:user</code>.
        </p>
        <div
          className="admin-scroll"
          role="region"
          aria-labelledby="admins"
          tabIndex={0}
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Status</th>
                <th scope="col">Authenticator</th>
                <th scope="col">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td>{a.email}</td>
                  <td>{a.status === "active" ? "Active" : "Disabled"}</td>
                  <td>{a.totp ? "Set up" : "Not set up"}</td>
                  <td>{when(a.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="changes" className="grid gap-4">
        <h2 id="changes" className="text-[26px]">
          Recent activity
        </h2>
        {audit.length === 0 ? (
          <p className="type-small">No activity recorded yet.</p>
        ) : (
          <div
            className="admin-scroll"
            role="region"
            aria-labelledby="changes"
            tabIndex={0}
          >
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">When (UTC)</th>
                  <th scope="col">Who</th>
                  <th scope="col">Action</th>
                  <th scope="col">Result</th>
                  <th scope="col">Changed</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((e, i) => (
                  <tr key={`${e.at}-${i}`}>
                    <td>{when(e.at)}</td>
                    <td>
                      {admins.find((a) => a.id === e.adminId)?.email ??
                        e.adminId}
                    </td>
                    <td>{e.action}</td>
                    <td>{e.outcome}</td>
                    <td>
                      {e.changes ? Object.keys(e.changes).join(", ") : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
