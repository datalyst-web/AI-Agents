import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat Agent Dashboard",
  description: "Manage your AI chat agents, knowledge base, and conversations.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Server-rendered default so pre-auth pages (login, signup, forgot/reset
    // password) are guaranteed dark from first paint — no reliance on the
    // client-side theme effect running first. AuthProvider's own effect
    // (lib/auth.tsx) overwrites this attribute once a real user with a real
    // theme preference loads; until then (including anyone not signed in)
    // it stays exactly this.
    <html lang="en" data-theme="dark">
      <body className="font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
