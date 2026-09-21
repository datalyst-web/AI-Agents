import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  // No title template on purpose: the public pages already set full,
  // self-branded titles ("Terms of Service — Datalyst Africa"), which a
  // template would double. Dashboard pages set their own at runtime —
  // see the (dashboard) layout — to follow a client's white-label brand.
  title: "Datalyst Africa",
  description: "AI chat agents for your business, built and managed for you by Datalyst Africa.",
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
if(t!=="light"&&t!=="dark")t="light";
document.documentElement.dataset.theme=t;
}catch(e){}})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Start light on every page; saved preferences are applied by the
    // bootstrap script or AuthProvider. The script can change this attribute
    // before hydration, so React must allow that expected difference.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PUBLIC_THEME_BOOTSTRAP }} />
      </head>
      <body className="font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
