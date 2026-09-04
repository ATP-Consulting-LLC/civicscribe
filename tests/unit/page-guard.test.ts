// requireStaffPage guards the staff-only pages. /enquiries uses it, and that
// page lists what members of the public typed into the contact form: their
// name, their email, and the IP the submission came from.
//
// It is one line at the top of a server component, which is exactly the kind of
// guard that gets refactored away by someone tidying imports. These tests assert
// it FIRES and that it refuses by calling notFound (a 404, so a visitor learns
// nothing about whether the route exists) rather than merely returning.

import { beforeEach, describe, expect, it, vi } from "vitest";

const NOT_FOUND = new Error("NEXT_NOT_FOUND");

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

async function load(staff: boolean) {
  const auth = await import("@/lib/auth/server");
  vi.spyOn(auth, "isStaff").mockResolvedValue(staff);
  const { requireStaffPage } = await import("@/lib/auth/page-guard");
  const { notFound } = await import("next/navigation");
  return { requireStaffPage, notFound: notFound as unknown as ReturnType<typeof vi.fn> };
}

describe("requireStaffPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("refuses a visitor who is not staff", async () => {
    const { requireStaffPage } = await load(false);
    await expect(requireStaffPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("refuses with notFound, so the route's existence is not disclosed", async () => {
    const { requireStaffPage, notFound } = await load(false);
    await expect(requireStaffPage()).rejects.toThrow();
    expect(notFound).toHaveBeenCalled();
  });

  it("lets staff through", async () => {
    const { requireStaffPage, notFound } = await load(true);
    await expect(requireStaffPage()).resolves.toBeUndefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("refuses when the staff check itself fails, rather than falling open", async () => {
    const auth = await import("@/lib/auth/server");
    vi.spyOn(auth, "isStaff").mockRejectedValue(new Error("cookie store down"));
    const { requireStaffPage } = await import("@/lib/auth/page-guard");
    // Whatever it throws, it must NOT resolve - a guard that returns normally
    // on an internal error would render the page to anyone.
    await expect(requireStaffPage()).rejects.toThrow();
  });
});
