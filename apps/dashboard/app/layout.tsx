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
