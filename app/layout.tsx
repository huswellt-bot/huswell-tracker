import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "@/components/theme-provider";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export const metadata: Metadata = {
  title: "Huswell Trading | Business Workspace",
  description: "Operations and finance workspace for Huswell Trading.",
  icons: {
    icon: "https://huswelltrading.com/favicon.ico",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`h-full antialiased font-sans ${geist.variable}`}
    >
      <body className="min-h-full flex flex-col">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute h-0 w-0 overflow-hidden"
          focusable="false"
        >
          <defs>
            <filter id="huswell-logo-transparent" colorInterpolationFilters="sRGB">
              <feColorMatrix
                type="matrix"
                values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 -1 0 0 1"
              />
            </filter>
          </defs>
        </svg>
        <ThemeProvider>{children}</ThemeProvider>
        <Script id="huswell-theme-bootstrap" strategy="beforeInteractive">
          {THEME_BOOTSTRAP_SCRIPT}
        </Script>
      </body>
    </html>
  );
}
