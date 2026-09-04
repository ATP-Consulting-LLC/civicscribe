"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// The public nav and the staff nav are different jobs and no longer pretend to
// be one list. A visitor is choosing between reading the archive and getting in
// touch; staff are operating the thing. "Meetings" (the operator dashboard),
// Schedules and Study Notes are staff surfaces and are hidden from the public.
const PUBLIC_LINKS = [
  { href: "/library", label: "Library" },
  { href: "/topics", label: "Topics" },
  { href: "/search", label: "Search" },
] as const;

const STAFF_LINKS = [
  { href: "/", label: "Meetings" },
  { href: "/library", label: "Library" },
  { href: "/topics", label: "Topics" },
  { href: "/schedules", label: "Schedules" },
  { href: "/study-notes", label: "Study notes" },
  { href: "/search", label: "Search" },
  { href: "/review", label: "Review" },
  { href: "/enquiries", label: "Enquiries" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Primary site navigation. Inline on desktop, a disclosure menu on mobile.
 *
 * Colour is NOT set here. The `nav-link` / `nav-cta` classes are styled in
 * globals.css, which flips them between dark-on-white and white-on-photo
 * depending on whether the page has a hero. Adding a Tailwind text colour to
 * these elements would defeat that and make the nav unreadable over the hero.
 */
export default function SiteNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const links = isAdmin ? STAFF_LINKS : PUBLIC_LINKS;

  async function signOut() {
    setOpen(false);
    // Clear both the per-user session and the legacy owner break-glass cookie.
    // Best-effort: a failed network call still drops the client-side menu.
    await Promise.allSettled([
      fetch("/api/logout", { method: "POST" }),
      fetch("/api/owner-logout", { method: "POST" }),
    ]);
    router.push("/");
    router.refresh();
  }

  // Close the menu after navigating.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const linkClass = (href: string) =>
    `nav-link rounded-md px-3 font-medium ${
      isActive(pathname, href)
        ? "underline decoration-2 underline-offset-8"
        : ""
    }`;

  const ctaClass =
    "nav-cta inline-flex min-h-11 items-center gap-2 rounded-lg px-5 font-semibold";

  return (
    <nav aria-label="Primary" className="flex items-center">
      {/* Desktop: inline links + CTA */}
      <ul className="hidden items-center gap-1 md:flex lg:gap-2">
        {links.map(({ href, label }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={isActive(pathname, href) ? "page" : undefined}
              className={linkClass(href)}
            >
              {label}
            </Link>
          </li>
        ))}

        {isAdmin ? (
          <>
            <li className="ml-2">
              <Link href="/meetings/new" className={ctaClass}>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add meeting
              </Link>
            </li>
            <li>
              <button
                type="button"
                onClick={signOut}
                className="nav-link rounded-md px-3 font-medium"
              >
                Sign out
              </button>
            </li>
          </>
        ) : (
          <>
            <li>
              <Link href="/login" className={linkClass("/login")}>
                Sign in
              </Link>
            </li>
            <li className="ml-2">
              <Link href="/#contact" className={ctaClass}>
                Talk to us
              </Link>
            </li>
          </>
        )}
      </ul>

      {/* Mobile: hamburger toggle */}
      <button
        type="button"
        className="nav-link inline-flex min-h-12 min-w-12 items-center justify-center rounded-md md:hidden"
        aria-expanded={open}
        aria-controls="primary-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-7 w-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" />
          )}
        </svg>
      </button>

      {/* Mobile: dropdown panel. Always the solid dark surface, never
          transparent, so it stays readable when it opens over the hero photo. */}
      {open && (
        <div
          id="primary-menu"
          className="absolute left-0 right-0 top-full z-20 border-t border-white/15 bg-dark px-4 py-3 shadow-lg md:hidden"
        >
          <ul className="flex flex-col gap-1">
            {links.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive(pathname, href) ? "page" : undefined}
                  className={`flex min-h-12 items-center rounded-md px-4 font-medium text-white ${
                    isActive(pathname, href)
                      ? "bg-white/15"
                      : "hover:bg-white/10"
                  }`}
                >
                  {label}
                </Link>
              </li>
            ))}
            {isAdmin ? (
              <>
                <li className="mt-2">
                  <Link
                    href="/meetings/new"
                    className={`${ctaClass} w-full justify-center`}
                  >
                    Add meeting
                  </Link>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={signOut}
                    className="flex min-h-12 w-full items-center rounded-md px-4 font-medium text-white hover:bg-white/10"
                  >
                    Sign out
                  </button>
                </li>
              </>
            ) : (
              <>
                <li>
                  <Link
                    href="/login"
                    className="flex min-h-12 items-center rounded-md px-4 font-medium text-white hover:bg-white/10"
                  >
                    Sign in
                  </Link>
                </li>
                <li className="mt-2">
                  <Link
                    href="/#contact"
                    className={`${ctaClass} w-full justify-center`}
                  >
                    Talk to us
                  </Link>
                </li>
              </>
            )}
          </ul>
        </div>
      )}
    </nav>
  );
}
