import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // The context pack (src/lib/context.ts) and the judge's grid (src/lib/judge) are read from disk
  // at runtime.
  outputFileTracingIncludes: { "/*": ["./context/jalon/**/*", "./src/lib/judge/rubric.md"] },
};

export default nextConfig;
