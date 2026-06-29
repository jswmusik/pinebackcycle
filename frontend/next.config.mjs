// Django-backendens adress. Lokalt: localhost:8001. I produktion/staging
// sätts BACKEND_ORIGIN till backendens URL (t.ex. https://pineback-api.onrender.com).
const BACKEND = process.env.BACKEND_ORIGIN || "http://localhost:8001";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next strippar trailing slash i proxningen, men Django kräver den.
  // skipTrailingSlashRedirect: Next redirectar inte klienten.
  // Vi lägger tillbaka slashen i destinationen så Django får /api/.../ .
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND}/api/:path*/` },
      { source: "/admin", destination: `${BACKEND}/admin/` },
      { source: "/admin/:path*", destination: `${BACKEND}/admin/:path*/` },
      { source: "/static/:path*", destination: `${BACKEND}/static/:path*` },
    ];
  },
};

export default nextConfig;
