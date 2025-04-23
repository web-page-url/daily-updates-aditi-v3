/** @type {import('next').NextConfig} */
const nextConfig = {
  // Configure for server-side rendering
  reactStrictMode: true,
  images: {
    domains: ['vercel.com'], // Add domains you need for external images
  },
  // Set rendering mode for pages
  experimental: {
    serverComponentsExternalPackages: [],
    scrollRestoration: true,
  },
  // Disable static page optimization globally
  swcMinify: true,
  // Add runtime configuration to improve tab behavior
  publicRuntimeConfig: {
    preserveFormState: true
  }
}

module.exports = nextConfig;