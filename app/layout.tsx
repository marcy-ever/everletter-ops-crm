import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Everletter Ops CRM",
  description: "Shared mailing operations CRM for Everletter.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
