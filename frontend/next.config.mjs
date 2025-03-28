import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});


const isDevelopment = process.env.NODE_ENV !== "production";
const rewritesConfig = isDevelopment
  ? [
    {
      source: "/admin-api-go/:path*", // Matched parameters can be used in the destination
      destination: "http://localhost:8002/:path*", // Destination URL can be configured by providing a "destination" property
    },
    {
      source: "/admin-api/:path*", // Matched parameters can be used in the destination
      destination: "http://localhost:8002/:path*", // Destination URL can be configured by providing a "destination" property
    },
    {
      source: "/api/auth/:path*",
      destination: "/api/auth/:path*",
    },
    {
      source: "/api/:path*", // Matched parameters can be used in the destination
      destination: "http://localhost:8002/api/:path*", // Destination URL can be configured by providing a "destination" property
    },
  ]
  : [];

export default withBundleAnalyzer({
  output: "export",
  reactStrictMode: false,
  images: {
    unoptimized: true
  },
  transpilePackages: ["react-hexgrid"],

  rewrites: async () => rewritesConfig,
  eslint: {
    ignoreDuringBuilds: true,
  },
});
