import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const config: NextConfig = {
  transpilePackages: [
    "@cellflow/api",
    "@cellflow/core",
    "@cellflow/db",
    "@cellflow/assertions",
    "@cellflow/webhooks",
    "@cellflow/reconcile",
    "@cellflow/webhook-delivery",
  ],
};

export default withWorkflow(config);
