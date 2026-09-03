import type { Metadata } from "next";
import { Geist } from "next/font/google";
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
    <html lang="en" className={`h-full antialiased font-sans ${geist.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
