import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import SiteNav from "@/components/dashboard/SiteNav";
import StaffSidebar from "@/components/dashboard/StaffSidebar";
import { getConfig } from "@/lib/config";
import { isStaff } from "@/lib/auth/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_NAME = "CivicScribe";
const SITE_DESCRIPTION =
  "We record your city's public meetings. We turn them into text you can search and read.";

// Site-wide metadata. metadataBase makes per-page relative OG/canonical URLs
// absolute; it comes from APP_BASE_URL (config.baseUrl) and falls back to
// localhost in dev. The defaults below are inherited by every page unless a
// route's generateMetadata overrides them.
export const metadata: Metadata = {
  metadataBase: new URL(getConfig().baseUrl),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

// Staff status is read per request (cookie), so the layout is never statically
// cached. Signed-in staff get a left sidebar; the public gets the top bar.
export const dynamic = "force-dynamic";

const FOOTER_TEXT = "© 2026 ATP Consulting LLC · CivicScribe";

/** The civic dome mark. Its stroke colour is set in globals.css so it can flip
 *  between the accent green and the on-photo bright green with the header. */
function BrandMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-8 w-8 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20h16" />
      <path d="M5 20v-7h14v7" />
      <path d="M7 13v7M12 13v7M17 13v7" />
      <path d="M5 13c0-3.9 3.1-7 7-7s7 3.1 7 7" />
      <path d="M12 6V3" />
    </svg>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-sm text-ink-faint sm:px-6">
        <span>{FOOTER_TEXT}</span>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-5">
          <Link href="/terms" className="underline underline-offset-4 hover:text-ink">
            Terms
          </Link>
          <Link href="/privacy" className="underline underline-offset-4 hover:text-ink">
            Privacy
          </Link>
          <Link href="/login" className="underline underline-offset-4 hover:text-ink">
            Staff sign-in
          </Link>
        </nav>
      </div>
    </footer>
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isAdmin = await isStaff();

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>

        {isAdmin ? (
          // Signed-in staff: left vertical sidebar (mobile drawer) + content.
          <div className="flex min-h-screen flex-col md:flex-row">
            <StaffSidebar />
            <div className="page-canvas flex min-h-screen flex-1 flex-col">
              <main
                id="main-content"
                className="site-main mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10"
              >
                {children}
              </main>
              <SiteFooter />
            </div>
          </div>
        ) : (
          // Public: top bar. On pages with a hero the header floats over the
          // photograph; everywhere else it is a solid sticky bar. That switch is
          // pure CSS (body:has(.home-hero)) so no route detection is needed here.
          <div className="page-canvas flex min-h-screen flex-col">
            <header className="site-header">
              <div className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
                <Link
                  href="/"
                  className="brand inline-flex min-h-12 items-center gap-3 rounded-md text-2xl font-bold tracking-tight"
                >
                  <BrandMark />
                  CivicScribe
                </Link>
                <SiteNav isAdmin={false} />
              </div>
            </header>
            <main
              id="main-content"
              className="site-main mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10"
            >
              {children}
            </main>
            <SiteFooter />
          </div>
        )}
      </body>
    </html>
  );
}
