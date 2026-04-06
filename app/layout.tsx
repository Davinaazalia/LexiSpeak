import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LexiSpeak",
  description: "LexiSpeak speaking practice web app ready for Vercel deployment.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="app-shell">
          <aside className="app-sidebar">
            <div className="sidebar-brand">
              <div className="brand-icon">L</div>
              <div>
                <p className="brand-title">LexiSpeak</p>
                <p className="brand-sub">Menu</p>
              </div>
            </div>
            <nav className="sidebar-nav">
              <Link href="/dashboard" className="nav-link">
                Dashboard
              </Link>
              <Link href="/progress" className="nav-link">
                Progress
              </Link>
              <Link href="/" className="nav-link">
                Session
              </Link>
            </nav>
          </aside>
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
