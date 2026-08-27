import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loopbase — SQL Optimization Lab",
  description: "Run arbitrary SQL, learn repeated joins, verify generated optimizations, and compare 1, 2, or 5-node Snowflake-like compute plans.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
