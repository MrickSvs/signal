import { Suspense } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { AppFrame } from "@/components/shell/app-frame";
import { HeaderStatus, HeaderStatusSkeleton } from "@/components/shell/header-status";
import { Sidebar } from "@/components/shell/sidebar";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Signal",
  description: "L'agent IA du Product Owner de Jalon",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${inter.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="flex h-full min-w-[1024px] overflow-hidden">
        <Sidebar />
        <AppFrame
          status={
            <Suspense fallback={<HeaderStatusSkeleton />}>
              <HeaderStatus />
            </Suspense>
          }
        >
          {children}
        </AppFrame>
      </body>
    </html>
  );
}
