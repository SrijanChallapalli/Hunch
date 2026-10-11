/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pg is a Node-only driver used by the API routes that read the indexer's database
  experimental: { serverComponentsExternalPackages: ["pg"] },
};

export default nextConfig;
