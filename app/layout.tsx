import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { AnalyticsListener } from "@/components/analytics/AnalyticsListener";
import { JsonLd } from "@/components/seo/JsonLd";
import { site } from "@/content/site";
import { services } from "@/content/services";
import { siteUrl } from "@/lib/site-url";
import { palette } from "@/lib/palette";
import { MOTION_BOOT_SCRIPT } from "@/lib/motion";
import { orgId, ref, websiteId } from "@/lib/schema";
import { getPublicSettings } from "@/lib/settings/public";
import "./globals.css";
import "./components.css";
import "./cinema.css";

// Self-hosted at build time by next/font: no requests to Google from visitors.
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

const jost = Jost({
  variable: "--font-jost",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "CALIX — Brand identity, web design and growth studio",
    template: "%s — CALIX",
  },
  description: site.description,
  openGraph: {
    type: "website",
    siteName: site.name,
    locale: "en_GB",
  },
  twitter: { card: "summary_large_image" },
  robots: process.env.NOINDEX === "true" ? { index: false, follow: false } : undefined,
  // Search Console and Bing Webmaster verification, set per environment when the properties are created.
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined,
  },
};

export const viewport: Viewport = {
  themeColor: palette.ivory,
};

/**
 * Pages stay static. Saving settings in the admin revalidates every page at once
 * (revalidatePath('/', 'layout')); this interval is the safety net for a build made without the
 * settings store (for example in CI): such pages pick up the saved settings within five minutes
 * of a deploy instead of showing the defaults until the next save. See docs/admin-panel-runbook.md.
 */
export const revalidate = 300;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const settings = await getPublicSettings();
  const facts = {
    ...(typeof settings.legalName === "string" ? { legalName: settings.legalName } : {}),
    ...(typeof settings.email === "string" ? { email: settings.email } : {}),
    ...(settings.phones[0] ? { telephone: settings.phones[0].e164 } : {}),
    ...(settings.address
      ? {
          address: {
            "@type": "PostalAddress",
            ...(settings.address.street ? { streetAddress: settings.address.street } : {}),
            ...(settings.address.locality ? { addressLocality: settings.address.locality } : {}),
            ...(settings.address.region ? { addressRegion: settings.address.region } : {}),
            ...(settings.address.postcode ? { postalCode: settings.address.postcode } : {}),
            addressCountry: settings.address.country,
          },
        }
      : {}),
  };
  return (
    // suppressHydrationWarning: the inline script below may set data-motion on <html> before hydration.
    <html lang="en" className={`${cormorant.variable} ${jost.variable}`} suppressHydrationWarning>
      <body>
        {/* Chooses the scroll-sequence layouts before first paint, so enabling them causes no layout shift. */}
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT_SCRIPT }} />
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <JsonLd
          data={[
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              "@id": orgId,
              name: site.name,
              url: siteUrl,
              description: site.description,
              slogan: site.positioning,
              logo: `${siteUrl}/brand/calix-primary.png`,
              sameAs: settings.profiles.map((p) => p.url),
              knowsAbout: services.map((s) => s.name),
              ...facts,
            },
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              "@id": websiteId,
              name: site.name,
              url: siteUrl,
              inLanguage: "en",
              publisher: ref(orgId),
            },
          ]}
        />
        {/* The sheet frame: two hairlines in the side margins (app/components.css, "Page frame"). */}
        <div className="page-frame" aria-hidden="true" />
        <SiteHeader />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
        <AnalyticsListener />
      </body>
    </html>
  );
}
