import postgres, { type Sql } from "postgres";

let singleton: Sql | undefined;

export function getSql(): Sql {
  if (singleton) return singleton;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  singleton = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return singleton;
}

export async function closeSql(): Promise<void> {
  if (!singleton) return;
  await singleton.end({ timeout: 5 });
  singleton = undefined;
}
