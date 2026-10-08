import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpsPilot | Customer Operations Agent",
  description: "Phase 1 order status agent"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}