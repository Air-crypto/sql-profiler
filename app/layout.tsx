import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loopbase — SQL Optimization Lab",
  description: "Run arbitrary SQL across realistic tables, learn repeated joins from the workload, model parallel execution, and verify generated optimizations.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
