import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Little Quest · Big discoveries start small",
  description:
    "A happy little place to learn. Explore Maths and English through playful, five-question adventures.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/fonts/nunito-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
