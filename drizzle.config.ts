import { defineConfig } from "drizzle-kit";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  throw new Error("SUPABASE_DB_URL must be set for Drizzle migrations");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
