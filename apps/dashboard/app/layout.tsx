import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat Agent Dashboard",
  description: "Manage your AI chat agents, knowledge base, and conversations.",
};

/**
 * Applies the visitor's public-page theme before first paint, so switching
 * to light doesn't flash dark on every navigation.
 *
 * Scoped by pathname to the signed-out surface (marketing, legal, guide
 * and the auth screens) on purpose. Inside the dashboard the theme is a
 * tenant setting AuthProvider applies from /me — a visitor's local
 * preference must not override a real saved setting there.
 */
const PUBLIC_THEME_BOOTSTRAP = `(function(){try{
if(["/","/guide","/terms","/privacy","/login","/signup","/forgot-password","/reset-password","/accept-invite"].indexOf(location.pathname.replace(/\\/$/,"")||"/")===-1)return;
var t=localStorage.getItem("datalyst:public-theme");
if(t!=="light"&&t!=="dark")t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";
document.documentElement.dataset.theme=t;
}catch(e){}})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Server-rendered default so pre-auth pages (login, signup, forgot/reset
    // password) are guaranteed dark from first paint — no reliance on the
    // client-side theme effect running first. AuthProvider's own effect
    // (lib/auth.tsx) overwrites this attribute once a real user with a real
    // theme preference loads; until then (including anyone not signed in)
    // it stays exactly this.
    <html lang="en" data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: PUBLIC_THEME_BOOTSTRAP }} />
      </head>
      <body className="font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
