// Staff-only list of enquiries from the public "for cities" form.
//
// This exists because email is not a delivery guarantee. RESEND_API_KEY is not
// currently set on the deployment, so the notification arm of /api/contact logs
// instead of sending - the enquiry is still stored, but nobody is told. Without
// this page a city that wrote in would sit in a table no human ever opens.
//
// It is NOT a substitute for the notification. It is the floor under it: even
// with email working, the row remains the record and this is where you read it.
//
// STAFF ONLY. These rows carry a member of the public's name, email and IP.
// The route refuses anyone who is not staff rather than rendering a filtered
// view, because there is no version of this page a visitor should see.

import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@/lib/store";
import { requireStaffPage } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Enquiries",
  robots: { index: false, follow: false },
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function EnquiriesPage() {
  // Before ANY read. See requireStaffPage - an unauthorised request must not
  // touch the enquiries table, not merely be refused the rendered output.
  await requireStaffPage();

  const enquiries = await getStore().listContactEnquiries(200);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl">Enquiries</h1>
        <p className="mt-3 max-w-2xl text-lg text-ink-soft">
          Cities that filled in the form on the front page. Newest first.
        </p>
      </header>

      {enquiries.length === 0 ? (
        <div className="max-w-2xl rounded-xl border border-line bg-tint p-8">
          <p className="text-lg">No enquiries yet.</p>
          <p className="mt-2 text-ink-soft">
            Anything sent through the form on the front page lands here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-5">
          {enquiries.map((e) => (
            <li
              key={e.id}
              className="rounded-xl border border-line bg-surface p-6 shadow-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-xl">{e.organization}</h2>
                <span className="text-sm text-ink-faint">
                  {when(e.created_at)}
                </span>
              </div>

              <p className="mt-2 text-ink-soft">
                <span className="font-semibold text-ink">{e.name}</span>
                {e.role ? ` · ${e.role}` : ""}
                {" · "}
                <a
                  href={`mailto:${e.email}`}
                  className="text-accent underline underline-offset-4"
                >
                  {e.email}
                </a>
              </p>

              <p className="mt-4 whitespace-pre-wrap">{e.message}</p>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-ink-faint">
        <Link href="/" className="underline underline-offset-4">
          Back to the dashboard
        </Link>
      </p>
    </div>
  );
}
