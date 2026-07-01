import { Inter } from "next/font/google";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import Providers from "@/components/Providers";
import { APP_VERSION } from "@/lib/version";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata = {
  title: "Pineback",
  description: "Planera och cykla din semester – etapper, höjdmeter, budget.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Pineback",
  },
};

export const viewport = {
  themeColor: "#0e0c17",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="sv" className={inter.variable}>
      <body>
        {/* Förvärm anslutningar till externa tjänster så kartrutor, flaggor och
            kartikoner laddar snabbare (DNS + TCP + TLS klart i förväg). */}
        <link rel="preconnect" href="https://a.tile.openstreetmap.org" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://b.tile.openstreetmap.org" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://c.tile.openstreetmap.org" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://flagcdn.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://unpkg.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://nominatim.openstreetmap.org" />
        <link rel="dns-prefetch" href="https://server.arcgisonline.com" />
        <link rel="dns-prefetch" href="https://a.tile.opentopomap.org" />
        <Providers>{children}</Providers>
        <footer className="app-footer">
          Pineback <span className="app-version">v{APP_VERSION}</span>
        </footer>
      </body>
    </html>
  );
}
