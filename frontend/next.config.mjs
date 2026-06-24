/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Dev-only proxy. In development the browser calls same-origin /api and
  // /health and Next forwards them to the local backend. In PRODUCTION the
  // frontend calls the backend directly via NEXT_PUBLIC_API_URL (see
  // lib/api.ts), so no rewrite is needed — and we must never proxy to
  // localhost. Returning [] in prod keeps the deploy clean.
  async rewrites() {
    const apiBase =
      process.env.NEXT_PUBLIC_API_BASE ||
      (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "");
    if (!apiBase) return [];
    return [
      { source: "/api/:path*", destination: `${apiBase}/api/:path*` },
      { source: "/health", destination: `${apiBase}/health` },
    ];
  },
};

export default nextConfig;
