import { errorResponse, requireBootstrapToken, setupSchema } from "@cellflow/api";
import { migrateDatabase } from "@cellflow/db";
import { readJson, service } from "../../../lib/server.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    // Authenticate before performing any schema-changing operation.
    requireBootstrapToken(request.headers.get("authorization"));
    const input = setupSchema.parse(await readJson(request));

    // First-use initialization is idempotent. A transaction-scoped PostgreSQL
    // advisory lock serializes concurrent Vercel invocations while migrations run.
    const migration = await migrateDatabase();

    // setupProject atomically permits only the first project. Its durable DB lock
    // replaces the old manual CELLFLOW_SETUP_ENABLED=true/false deployment toggle.
    const result = await service.setupProject({
      name: input.name,
      network: input.network,
      ...(input.rpcUrl === undefined ? {} : { rpcUrl: input.rpcUrl }),
      ...(input.confirmationPolicy === undefined ? {} : { confirmationPolicy: input.confirmationPolicy }),
    });

    return Response.json(
      {
        project: result.project,
        apiKey: result.apiKey,
        initialization: {
          schemaReady: true,
          latestMigration: migration.latest,
          migrationsApplied: migration.applied,
          bootstrapLocked: true,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
