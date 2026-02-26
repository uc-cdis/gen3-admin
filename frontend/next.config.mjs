import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});


const isDevelopment =
  process.env.NEXT_PUBLIC_BOOTSTRAP_MODE === "true" || process.env.NODE_ENV !== "production";

const API_BASE_URL =
  process.env.API_BASE_URL || "http://localhost:8002";

const rewritesConfig = isDevelopment
  ? [
    {
      source: "/admin-api-go/:path*", // Matched parameters can be used in the destination
      destination: `${API_BASE_URL}/:path*`, // Destination URL can be configured by providing a "destination" property
    },
    {
      source: "/admin-api/:path*", // Matched parameters can be used in the destination
      destination: `${API_BASE_URL}/:path*`, // Destination URL can be configured by providing a "destination" property
    },
    {
      source: "/api/auth/:path*",
      destination: "/api/auth/:path*",
    },
    {
      source: "/api/:path*/", // Matches paths ending with /
      destination: `${API_BASE_URL}/api/:path*/`,
    },
    {
      source: "/api/:path*", // Matched parameters can be used in the destination
      destination: `${API_BASE_URL}/api/:path*`, // Destination URL can be configured by providing a "destination" property
    },
  ]
  : [];

export default withBundleAnalyzer({
  // output: "export",
  // images: {
  //   unoptimized: true
  // },
  reactStrictMode: false,
  transpilePackages: ["react-hexgrid"],
  skipTrailingSlashRedirect: true,
  rewrites: async () => rewritesConfig,
  experimental: {
    proxyTimeout: 100000000,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
});
