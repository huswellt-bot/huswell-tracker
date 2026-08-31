import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Huswell Trading | Business Workspace",
  description: "Operations and finance workspace for Huswell Trading.",
  icons: {
    icon: "https://huswelltrading.com/favicon.ico",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased font-sans">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
