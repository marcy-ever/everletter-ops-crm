import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/batch-mailing-photo": ["./node_modules/@tesseract.js-data/eng/**/*", "./node_modules/tesseract.js-core/**/*"],
  },
};

export default nextConfig;
