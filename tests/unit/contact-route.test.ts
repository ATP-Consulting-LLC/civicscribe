// POST /api/contact (src/app/api/contact/route.ts).
//
// This is the only public, unauthenticated write endpoint on the site, and the
// only path by which a paying customer reaches the business. Three properties
// have to hold, and all three are the kind that silently stop working:
//
//   1. The enquiry is STORED before the email is attempted, and a failed email
//      does NOT fail the request - the lead is already safe, and reporting a
//      failure would invite a duplicate.
//   2. The honeypot rejects bots, and does so with a 200 so the spammer gets no
//      signal to iterate against.
//   3. The per-IP rate limit actually engages.
//
// Each guard is tested by watching it FIRE, not merely by exercising the happy
// path around it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const VALID = {
  name: "Jane Clerk",
  email: "jane@somecity.gov",
  organization: "Town of Somewhere",
  role: "Town Clerk",
  message: "We record our council meetings on Zoom. What would this cost?",
};

/** Each test gets a distinct IP so the shared in-process limiter, which is
 *  module state and persists between tests, cannot leak across them. */
let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function req(body: unknown, ip: string): Request {
  return new Request("https://example.test/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

/** Stub the store and the email provider so no backend is touched. */
async function stub(
  opts: { storeThrows?: boolean; emailThrows?: boolean } = {},
) {
  const store = await import("@/lib/store");
  const providers = await import("@/lib/providers");

  const createContactEnquiry = opts.storeThrows
    ? vi.fn().mockRejectedValue(new Error("db down"))
    : vi.fn().mockResolvedValue({ id: "enq-1" });

  const sendContactEnquiry = opts.emailThrows
    ? vi.fn().mockRejectedValue(new Error("resend down"))
    : vi.fn().mockResolvedValue(undefined);

  vi.spyOn(store, "getStore").mockReturnValue({
    createContactEnquiry,
  } as unknown as ReturnType<typeof store.getStore>);

  vi.spyOn(providers, "getProviders").mockReturnValue({
    email: { sendContactEnquiry },
  } as unknown as ReturnType<typeof providers.getProviders>);

  return { createContactEnquiry, sendContactEnquiry };
}

async function post(body: unknown, ip = freshIp()) {
  const { POST } = await import("@/app/api/contact/route");
  return POST(req(body, ip));
}

describe("POST /api/contact", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("stores the enquiry and emails the team inbox", async () => {
    const { createContactEnquiry, sendContactEnquiry } = await stub();
    const res = await post(VALID);

    expect(res.status).toBe(200);
    expect(createContactEnquiry).toHaveBeenCalledTimes(1);
    expect(createContactEnquiry.mock.calls[0][0]).toMatchObject({
      name: VALID.name,
      email: VALID.email,
      organization: VALID.organization,
    });
    expect(sendContactEnquiry).toHaveBeenCalledTimes(1);
  });

  it("delivers to the configured inbox, not to a hardcoded address", async () => {
    const { sendContactEnquiry } = await stub();
    const { getConfig } = await import("@/lib/config");
    await post(VALID);
    expect(sendContactEnquiry.mock.calls[0][0]).toBe(
      getConfig().contactInboxEmail,
    );
  });

  // The ordering property. If this inverts, a storage outage would start
  // producing leads that exist only in an inbox.
  it("stores BEFORE emailing, so a lead is never email-only", async () => {
    const order: string[] = [];
    const store = await import("@/lib/store");
    const providers = await import("@/lib/providers");
    vi.spyOn(store, "getStore").mockReturnValue({
      createContactEnquiry: vi.fn(async () => {
        order.push("store");
        return { id: "enq-1" };
      }),
    } as unknown as ReturnType<typeof store.getStore>);
    vi.spyOn(providers, "getProviders").mockReturnValue({
      email: {
        sendContactEnquiry: vi.fn(async () => {
          order.push("email");
        }),
      },
    } as unknown as ReturnType<typeof providers.getProviders>);

    await post(VALID);
    expect(order).toEqual(["store", "email"]);
  });

  it("still succeeds when the email fails, because the enquiry is already saved", async () => {
    const { createContactEnquiry } = await stub({ emailThrows: true });
    const res = await post(VALID);

    expect(createContactEnquiry).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    // and it is loud about it, so a broken Resend key is discoverable
    expect(console.error).toHaveBeenCalled();
  });

  it("fails the request when the enquiry cannot be stored", async () => {
    const { sendContactEnquiry } = await stub({ storeThrows: true });
    const res = await post(VALID);

    expect(res.status).toBe(500);
    // No point emailing about a row that does not exist.
    expect(sendContactEnquiry).not.toHaveBeenCalled();
  });

  describe("the honeypot", () => {
    it("rejects a submission that filled the hidden field", async () => {
      const { createContactEnquiry, sendContactEnquiry } = await stub();
      const res = await post({ ...VALID, website: "http://spam.example" });

      expect(createContactEnquiry).not.toHaveBeenCalled();
      expect(sendContactEnquiry).not.toHaveBeenCalled();
      // 200, not 4xx: a bot author who sees an error learns what to change.
      expect(res.status).toBe(200);
    });

    it("lets a submission through when the hidden field is empty or absent", async () => {
      const { createContactEnquiry } = await stub();
      await post({ ...VALID, website: "" });
      expect(createContactEnquiry).toHaveBeenCalledTimes(1);
    });
  });

  describe("the rate limit", () => {
    it("engages after repeated submissions from one address", async () => {
      const { createContactEnquiry } = await stub();
      const ip = freshIp();

      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        statuses.push((await post(VALID, ip)).status);
      }

      // It must actually block, not merely be present.
      expect(statuses).toContain(429);
      expect(statuses.filter((s) => s === 200).length).toBeLessThan(7);
      // Blocked requests never reach the store.
      expect(createContactEnquiry.mock.calls.length).toBe(
        statuses.filter((s) => s === 200).length,
      );
    });

    it("does not punish a different address for the first one's traffic", async () => {
      await stub();
      const noisy = freshIp();
      for (let i = 0; i < 7; i++) await post(VALID, noisy);

      const innocent = await post(VALID, freshIp());
      expect(innocent.status).toBe(200);
    });
  });

  describe("validation", () => {
    it.each([
      ["missing name", { ...VALID, name: "" }],
      ["missing organization", { ...VALID, organization: "" }],
      ["missing message", { ...VALID, message: "" }],
      ["malformed email", { ...VALID, email: "not-an-email" }],
    ])("rejects %s with a message a person can act on", async (_label, body) => {
      await stub();
      const res = await post(body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error?: string };
      expect(typeof json.error).toBe("string");
      expect(json.error!.length).toBeGreaterThan(0);
    });

    it("rejects a message long enough to be an attack", async () => {
      const { createContactEnquiry } = await stub();
      const res = await post({ ...VALID, message: "x".repeat(10_001) });
      expect(res.status).toBe(400);
      expect(createContactEnquiry).not.toHaveBeenCalled();
    });

    it("rejects a body that is not JSON", async () => {
      await stub();
      const { POST } = await import("@/app/api/contact/route");
      const res = await POST(
        new Request("https://example.test/api/contact", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "not json at all",
        }),
      );
      expect(res.status).toBe(400);
    });
  });
});
