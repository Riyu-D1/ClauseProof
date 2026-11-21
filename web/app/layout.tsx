import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

export const metadata: Metadata = {
  title: "ClauseProof — Alert Triage Console",
  description:
    "Transaction-monitoring alert triage: CLOSE / RFI / ESCALATE with policy-cited reasons and evidence.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${jbmono.variable}`}>
      <body className="min-h-screen">
        <div className="backdrop" />
        <div className="gridlines" />
        {children}
      </body>
    </html>
  );
}
