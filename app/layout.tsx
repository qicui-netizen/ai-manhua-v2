import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "PanelForge · 漫格",
  description: "OC / 同人创作者的轻量短篇漫画成稿与外平台发布工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full bg-[var(--color-bg)]">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
