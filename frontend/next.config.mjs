/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Proxy API calls to the FastAPI backend during development.
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiBase}/api/:path*`,
      },
      {
        // Backend health probe (used to detect live vs demo mode).
        source: "/health",
        destination: `${apiBase}/health`,
      },
    ];
  },
};

export default nextConfig;
