import { config } from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Load .env.local first (Next.js convention), then .env as fallback
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

const dbUrl = process.env["SUPABASE_DB_URL"] ?? process.env["DATABASE_URL"];
const separator = dbUrl?.includes("?") ? "&" : "?";
const urlWithSearchPath = dbUrl
  ? dbUrl + separator + "search_path=unerr,public"
  : undefined;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: urlWithSearchPath,
  },
});
