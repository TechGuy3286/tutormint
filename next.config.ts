import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'tutormint.org',
          },
        ],
        destination: 'https://www.tutormint.org/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;