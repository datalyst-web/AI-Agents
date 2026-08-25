/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@chat-agent/ui", "@chat-agent/shared-types"],
  reactStrictMode: true,
};

export default nextConfig;
