import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/tutor/login',
        destination: '/login',
        permanent: true,
      },
      {
        source: '/parent/login',
        destination: '/login',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            nosniff: 'nosniff',
          },
        ],
      },
    ];
  },
};

// Force canonical www domain consistency
module.exports = {
  ...nextConfig,
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