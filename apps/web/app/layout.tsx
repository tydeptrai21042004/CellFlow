import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CellFlow — CKB Transaction Operations",
  description: "Durable CKB transaction lifecycle, recovery and expected-Cell verification.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
