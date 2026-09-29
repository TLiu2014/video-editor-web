import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The marketing app is fully static-renderable today; flipping
  // `output: 'export'` later would let us drop the Node runtime.
  // Left dynamic for now so we can add server actions/RSC fetches
  // (sitemap, blog posts, etc.) without restructuring.
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
