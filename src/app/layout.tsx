import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// Use system font stack instead of Google Fonts to avoid build failures
// when offline or when Google Fonts is unreachable (common in Docker/CI).
// This also improves performance and avoids external requests.
// If you want Inter, you can add it locally via next/font/local.
const interVariable = "--font-inter";

export const metadata: Metadata = {
  title: "MC Bot Manager",
  description:
    "Spin up Minecraft bots, watch them join servers, and control their consoles.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={interVariable}>
      <body className="min-h-screen bg-[#070b14] text-slate-100 antialiased font-sans">
        <div className="app-bg" aria-hidden />
        {children}
      </body>
    </html>
  );
}
