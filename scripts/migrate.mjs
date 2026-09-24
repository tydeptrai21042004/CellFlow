import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const directory = path.resolve("packages/db/migrations");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const statement = await readFile(path.join(directory, file), "utf8");
    console.log(`Applying ${file}`);
    await sql.unsafe(statement);
  }
  console.log("Migrations complete.");
} finally {
  await sql.end({ timeout: 5 });
}
