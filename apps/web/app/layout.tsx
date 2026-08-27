import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PwaRegistration } from "../components/PwaRegistration";
import "@xterm/xterm/css/xterm.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Terminus",
  description: "Private terminal client scaffold",
  applicationName: "Terminus",
  icons: [{ rel: "icon", url: "/icon.svg", type: "image/svg+xml" }],
};

export const viewport: Viewport = {
  colorScheme: "dark",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#07100d",
  width: "device-width",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
