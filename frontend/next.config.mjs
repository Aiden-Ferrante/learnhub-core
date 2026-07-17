/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Enable standalone output for optimized Docker builds
  output: 'standalone',
  // Remove API route timeout limits for large model processing
  serverRuntimeConfig: {
    // No duration limit - let large models complete naturally
    maxDuration: 0,
  },
}

export default nextConfig
