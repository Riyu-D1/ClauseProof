import type { Metadata } from "next";
import { Doto, Space_Grotesk, Space_Mono } from "next/font/google";
import GuidedTour from "@/components/GuidedTour";
import SiteNav from "@/components/SiteNav";
import "./globals.css";

const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk" });
const spacemono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-spacemono",
});
const doto = Doto({ subsets: ["latin"], variable: "--font-doto-src" });

export const metadata: Metadata = {
  title: "ClauseProof — Alert Triage Console",
  description:
    "Transaction-monitoring alert triage: CLOSE / RFI / ESCALATE with policy-cited reasons and evidence.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${grotesk.variable} ${spacemono.variable} ${doto.variable}`}
    >
      <body className="min-h-screen">
        <div className="backdrop" />
        <SiteNav />
        {children}
        <GuidedTour />
      </body>
    </html>
  );
}
