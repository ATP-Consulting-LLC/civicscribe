// Real EmailProvider backed by Resend (https://resend.com).
// Per the spec this provider is deliberately stub-friendly: when
// RESEND_API_KEY is missing it logs the email to the console (dev behavior)
// instead of throwing, so the notify stage never blocks the pipeline.

import type { AppConfig } from "@/lib/config";
import type {
  ContactEnquiryInput,
  EmailProvider,
} from "@/lib/providers/types";
import type { Meeting, Summary } from "@/lib/types";

// Resend's sandbox sender — works without a verified domain for testing.
// Swap for a verified-domain address when going to production.
const FROM_ADDRESS = "CivicScribe <onboarding@resend.dev>";

function snippet(text: string, max = 300): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class ResendEmailProvider implements EmailProvider {
  constructor(private readonly config: AppConfig) {}

  private meetingLink(meeting: Meeting): string {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    return `${base}/meetings/${meeting.id}`;
  }

  async sendCompletionEmail(
    to: string,
    meeting: Meeting,
    summary: Summary | null
  ): Promise<void> {
    const link = this.meetingLink(meeting);
    const subject = `[CivicScribe] ${meeting.title}: ${meeting.status}`;

    if (!this.config.resendApiKey) {
      // Dev stub: no key, no send — log instead (spec'd behavior).
      console.log(
        "[CivicScribe email stub] RESEND_API_KEY not set — logging instead of sending."
      );
      console.log(`[CivicScribe email stub] To: ${to}`);
      console.log(`[CivicScribe email stub] Subject: ${subject}`);
      console.log(
        `[CivicScribe email stub] Meeting "${meeting.title}" (${meeting.body_name}) is now "${meeting.status}".`
      );
      if (summary?.overview) {
        console.log(
          `[CivicScribe email stub] Overview: ${snippet(summary.overview)}`
        );
      }
      console.log(`[CivicScribe email stub] View it at: ${link}`);
      return;
    }

    const html = [
      `<h2>${escapeHtml(meeting.title)}</h2>`,
      `<p><strong>${escapeHtml(meeting.body_name)}</strong>, status: <strong>${escapeHtml(meeting.status)}</strong></p>`,
      summary?.overview
        ? `<p>${escapeHtml(summary.overview)}</p>`
        : "<p>No summary is available for this meeting.</p>",
      `<p><a href="${escapeHtml(link)}">Open the full transcript and summary</a></p>`,
    ].join("\n");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [to],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Resend POST /emails failed with HTTP ${res.status}: ${snippet(body) || "(empty body)"}`
      );
    }
  }

  async sendContactEnquiry(
    to: string,
    enquiry: ContactEnquiryInput
  ): Promise<void> {
    const subject = `[CivicScribe] Enquiry from ${enquiry.organization}`;

    if (!this.config.resendApiKey) {
      // Same dev stub as above: no key, log rather than throw, so local work
      // does not need a Resend account.
      console.log(
        "[CivicScribe email stub] RESEND_API_KEY not set - logging the enquiry instead of sending."
      );
      console.log(`[CivicScribe email stub] To: ${to}`);
      console.log(`[CivicScribe email stub] Subject: ${subject}`);
      console.log(
        `[CivicScribe email stub] ${enquiry.name} (${enquiry.role || "role not given"}) at ${enquiry.organization}, ${enquiry.email}`
      );
      console.log(`[CivicScribe email stub] ${snippet(enquiry.message, 500)}`);
      return;
    }

    const rows: Array<[string, string]> = [
      ["Name", enquiry.name],
      ["Job", enquiry.role || "not given"],
      ["City or town", enquiry.organization],
      ["Email", enquiry.email],
    ];
    const html = [
      `<h2>New enquiry from ${escapeHtml(enquiry.organization)}</h2>`,
      "<table cellpadding='6' style='border-collapse:collapse'>",
      ...rows.map(
        ([k, v]) =>
          `<tr><td style="color:#555">${escapeHtml(k)}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`
      ),
      "</table>",
      `<p style="white-space:pre-wrap">${escapeHtml(enquiry.message)}</p>`,
    ].join("\n");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [to],
        // So a reply from the inbox goes straight back to the sender rather
        // than to the Resend sandbox address.
        reply_to: enquiry.email,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Resend POST /emails failed with HTTP ${res.status}: ${snippet(body) || "(empty body)"}`
      );
    }
  }
}
