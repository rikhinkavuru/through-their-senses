import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next } from "next/font/google";
import "./globals.css";

// Designed by the Braille Institute for readers with low vision.
const atkinson = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://through-their-senses.vercel.app"),
  title: "Through Their Senses",
  description:
    "See the world and hear conversation the way someone with glaucoma and hearing loss does, from their real test results, and plan together what to change.",
  applicationName: "Through Their Senses",
  appleWebApp: { capable: true, title: "Their Senses", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#f3f4f0",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={atkinson.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
