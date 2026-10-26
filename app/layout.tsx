import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Автопост — одно объявление, больше площадок",
  description: "Подготовьте объявление о продаже автомобиля или автозапчасти для площадок Беларуси с помощником Автопост.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
