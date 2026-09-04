// Guards for staff-only PAGES (as opposed to API routes, which use requireStaff
// from @/lib/owner and answer with a status code).
//
// This lives in its own plain-TypeScript module rather than inline at the top of
// each page for one practical reason: a server component is .tsx, and the test
// runner is configured for Next's jsx:"preserve", so a page module cannot be
// imported in a unit test without changing shared test config. A guard nobody
// can test is a guard that quietly stops working. Here it is testable.

import { notFound } from "next/navigation";

import { isStaff } from "@/lib/auth/server";

/**
 * Refuse a non-staff visitor with a 404.
 *
 * 404 rather than 403 on purpose: a visitor learns nothing about whether the
 * route exists, matching how unpublished meeting pages already behave.
 *
 * Call this BEFORE reading anything. The point is that an unauthorised request
 * never touches the data, not merely that it is not shown it.
 */
export async function requireStaffPage(): Promise<void> {
  if (!(await isStaff())) notFound();
}
