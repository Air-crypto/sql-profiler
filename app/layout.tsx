import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loopbase — SQL Optimization Lab",
  description: "Run SQL against a realistic sample dataset and test evidence-backed optimizations.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
