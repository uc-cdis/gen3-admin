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
      // Trailing-slash variant; same exclusions as below.
      source: "/api/:path((?!auth/|obs/).*)/",
      destination: `${API_BASE_URL}/api/:path*/`,
    },
    {
      // Everything else under /api goes to the Go API.
      //
      // The negative lookahead keeps Next's own API routes local. Without it a
      // flat rewrites array (which Next treats as `afterFiles`) still shadows
      // *dynamic* routes such as /api/obs/[backend], because those resolve after
      // afterFiles rewrites -- static ones like /api/obs/capabilities survive,
      // which makes the failure look inconsistent.
      source: "/api/:path((?!auth/|obs/).*)",
      destination: `${API_BASE_URL}/api/:path*`,
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
