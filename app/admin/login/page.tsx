import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAdmin, readPre } from "@/lib/admin/session";
import { pendingEnrolment } from "@/lib/admin/enrolment";
import { otpauthUri } from "@/lib/admin/totp";
import { qrMatrix } from "@/lib/admin/qr";
import { CodeForm, EnrolForm, PasswordForm } from "./LoginForms";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  const step = (await searchParams).step;
  const session = await currentAdmin();
  // The enrolment step stays on this page after sign-in, so the recovery codes can be shown once.
  if (session && step !== "enrol") redirect("/admin");
  const pre = await readPre();

  if (step === "enrol" && (session || pre?.stage === "enrol")) {
    const pending = session ? null : await pendingEnrolment();
    const uri = pending ? otpauthUri(pending.secret, pending.email) : null;
    return (
      <section className="grid gap-6">
        <h1 className="text-[34px]">Set up your authenticator</h1>
        <EnrolForm secret={pending?.secret ?? null} uri={uri} qr={uri ? qrMatrix(uri) : null} />
      </section>
    );
  }
  if (step === "code" && pre?.stage === "totp") {
    return (
      <section className="grid gap-6">
        <h1 className="text-[34px]">Enter your code</h1>
        <CodeForm />
      </section>
    );
  }
  const incomplete = (await searchParams).signout === "incomplete";
  return (
    <section className="grid gap-6">
      <h1 className="text-[34px]">Sign in</h1>
      {incomplete ? (
        <div className="error-summary" role="alert">
          <p className="font-medium">Sign-out was not completed on the server.</p>
          <p className="mt-2 type-small">
            This browser is signed out, but the server could not record it, so a copy of the session would keep working until it
            expires. Sign in again and use Sign out on every device, or ask the site operator to check the server.
          </p>
        </div>
      ) : null}
      <PasswordForm />
    </section>
  );
}
