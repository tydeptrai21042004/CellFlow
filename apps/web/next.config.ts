import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: [
    "@cellflow/api",
    "@cellflow/core",
    "@cellflow/db",
    "@cellflow/assertions",
    "@cellflow/webhooks",
    "@cellflow/reconcile",
    "@cellflow/webhook-delivery",
  ],
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default withWorkflow(config);
