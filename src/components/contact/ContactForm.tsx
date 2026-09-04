"use client";

import { useState } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

/**
 * The "for cities" enquiry form.
 *
 * Deliberately plain: a real form POSTing JSON, with the submit button disabled
 * while in flight and the outcome announced in a live region. No client-side
 * validation beyond `required` and `type=email` - the server is the authority,
 * and duplicating rules here only creates two places to disagree.
 *
 * The `website` field is a honeypot. It is off-screen and hidden from assistive
 * technology, so no real person will fill it; a bot that fills every input will.
 * The server rejects any submission that carries it.
 */
export default function ContactForm() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === "sending") return;
    setStatus({ kind: "sending" });

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setStatus({ kind: "ok" });
        form.reset();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setStatus({
        kind: "error",
        message:
          typeof body?.error === "string"
            ? body.error
            : "Something went wrong. Please try again.",
      });
    } catch {
      setStatus({
        kind: "error",
        message:
          "We could not send that. Check your connection and try again.",
      });
    }
  }

  if (status.kind === "ok") {
    return (
      <p className="home-form__status home-form__status--ok" role="status">
        Thank you. We have your note and we will write back soon.
      </p>
    );
  }

  return (
    <form className="home-form" onSubmit={onSubmit} noValidate={false}>
      <div>
        <label htmlFor="cf-name">Your name</label>
        <input id="cf-name" name="name" type="text" required autoComplete="name" />
      </div>
      <div>
        <label htmlFor="cf-role">Your job</label>
        <input
          id="cf-role"
          name="role"
          type="text"
          placeholder="Clerk, manager, IT"
          autoComplete="organization-title"
        />
      </div>
      <div>
        <label htmlFor="cf-org">City or town</label>
        <input
          id="cf-org"
          name="organization"
          type="text"
          required
          autoComplete="organization"
        />
      </div>
      <div>
        <label htmlFor="cf-email">Email</label>
        <input
          id="cf-email"
          name="email"
          type="email"
          required
          autoComplete="email"
        />
      </div>
      <div className="home-form__full">
        <label htmlFor="cf-message">What do you want recorded?</label>
        <textarea id="cf-message" name="message" required />
      </div>

      {/* Honeypot. Hidden from sight and from screen readers on purpose. */}
      <div className="home-form__trap" aria-hidden="true">
        <label htmlFor="cf-website">Leave this empty</label>
        <input
          id="cf-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {status.kind === "error" && (
        <p className="home-form__status home-form__status--bad" role="alert">
          {status.message}
        </p>
      )}

      <div className="home-form__full">
        <button type="submit" disabled={status.kind === "sending"}>
          {status.kind === "sending" ? "Sending..." : "Send"}
        </button>
      </div>
    </form>
  );
}
