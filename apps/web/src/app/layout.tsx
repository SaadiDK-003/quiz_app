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
      <body>{children}</body>
    </html>
  );
}
