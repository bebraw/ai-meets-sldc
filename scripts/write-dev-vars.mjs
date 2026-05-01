import { writeFile } from "node:fs/promises";
import { config } from "dotenv";

config();

const values = {
  EMAIL_ENCRYPTION_KEY: process.env.EMAIL_ENCRYPTION_KEY,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ?? "",
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY ?? "",
};

if (!values.EMAIL_ENCRYPTION_KEY) {
  console.error(
    "Missing EMAIL_ENCRYPTION_KEY. Copy .env.example to .env and set a local secret.",
  );
  process.exit(1);
}

const contents = Object.entries(values)
  .map(([key, value]) => `${key}="${String(value).replaceAll('"', '\\"')}"`)
  .join("\n");

await writeFile(".dev.vars", `${contents}\n`);
console.log("Wrote .dev.vars for Wrangler local development.");
