import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loopbase — SQL Optimization Lab",
  description: "Run complex SQL across realistic tables, inspect repeated joins, and test query rewrites or materialized structures side by side.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
