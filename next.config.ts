import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // The context pack is read from disk at runtime (src/lib/context.ts).
  outputFileTracingIncludes: { "/*": ["./context/jalon/**/*"] },
};

export default nextConfig;
