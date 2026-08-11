import type { Metadata, Viewport } from "next";
import "./globals.css";

import { SiteHeader } from "./_components/site-header";

export const metadata: Metadata = {
  title: "tutu-swipe — подбор путешествий",
  description:
    "Опишите поездку одной фразой — соберём дорогу и жильё в готовые варианты. Проект ИИ-хакатона Туту.",
};

export const viewport: Viewport = {
  themeColor: "#0d0b68",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        <SiteHeader />
        {children}
        <footer className="border-t border-divider px-4 py-6 sm:px-8">
          <p className="mx-auto w-full max-w-5xl text-xs leading-5 text-ink-muted">
            Проект ИИ-хакатона Туту, 2026. Неофициальный прототип: продукт
            использует открытый MCP Туту и оформлен в стиле сервиса, но не
            является его официальным приложением.
          </p>
        </footer>
      </body>
    </html>
  );
}
