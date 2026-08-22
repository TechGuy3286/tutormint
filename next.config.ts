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
};

export default nextConfig;