import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  experimental: {
    proxyClientMaxBodySize: "50mb",
  },
  async rewrites() {
    const apiUrl = process.env.API_URL || "http://localhost:3001";
    return {
      beforeFiles: [
        // WebSocket for the SWOT interview Live session. Next.js proxies
        // the HTTP Upgrade request to the Rust backend, so the browser
        // can stay same-origin instead of hitting the backend directly.
        {
          source: "/api/workspaces/:wid/swot/interview/live",
          destination: `${apiUrl}/api/workspaces/:wid/swot/interview/live`,
        },
        // WebSocket for the Baisync Agent (Sophie) voice panel.
        {
          source: "/api/baisync/voice/live",
          destination: `${apiUrl}/api/baisync/voice/live`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
