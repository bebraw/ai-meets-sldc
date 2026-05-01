import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const databaseName = "ai-meets-sdlc-interests";
const selectContacts = `
  SELECT
    email_ciphertext,
    email_iv,
    name_ciphertext,
    name_iv,
    organization_ciphertext,
    organization_iv,
    created_at
  FROM interests
  ORDER BY created_at ASC
`;

const options = parseOptions(process.argv.slice(2));
const secret = process.env.EMAIL_ENCRYPTION_KEY;

if (options.help) {
  printUsage();
  process.exit(0);
}

if (!secret) {
  console.error("Missing EMAIL_ENCRYPTION_KEY.");
  printUsage();
  process.exit(1);
}

const sourceCount = [options.input, options.remote, options.local].filter(
  Boolean,
).length;

if (sourceCount !== 1) {
  console.error(
    "Choose exactly one data source: --remote, --local, or --input.",
  );
  printUsage();
  process.exit(1);
}

const rows = options.input
  ? await readRowsFromBackup(options.input)
  : await readRowsFromD1({ remote: options.remote });
const contacts = await Promise.all(
  rows.map((row) => decryptContact(row, secret)),
);

if (options.format === "json") {
  console.log(`${JSON.stringify(contacts, null, 2)}\n`);
} else {
  writeCsv(contacts);
}

function parseArgs(args) {
  const options = {
    format: "csv",
    help: false,
    input: "",
    local: false,
    remote: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--format":
        if (!next || !["csv", "json"].includes(next)) {
          throw new Error("Expected --format to be csv or json.");
        }
        options.format = next;
        index++;
        break;
      case "--input":
        if (!next) {
          throw new Error("Missing path after --input.");
        }
        options.input = next;
        index++;
        break;
      case "--local":
        options.local = true;
        break;
      case "--remote":
        options.remote = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseOptions(args) {
  try {
    return parseArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid options.");
    printUsage();
    process.exit(1);
  }
}

async function readRowsFromBackup(inputPath) {
  const backup = JSON.parse(await readFile(inputPath, "utf8"));

  return Array.isArray(backup.rows) ? backup.rows : backup;
}

async function readRowsFromD1({ remote }) {
  const wranglerPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "node_modules",
    ".bin",
    "wrangler",
  );
  const args = [
    "d1",
    "execute",
    databaseName,
    remote ? "--remote" : "--local",
    "--json",
    "--command",
    selectContacts,
  ];
  const { stdout } = await execFileAsync(wranglerPath, args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  const payload = JSON.parse(stdout);

  return extractD1Rows(payload);
}

function extractD1Rows(payload) {
  if (Array.isArray(payload)) {
    if (payload.some((entry) => Array.isArray(entry?.results))) {
      return payload.flatMap((entry) =>
        Array.isArray(entry?.results) ? entry.results : [],
      );
    }
  }

  if (Array.isArray(payload?.results)) return payload.results;

  throw new Error("Could not find D1 results in Wrangler output.");
}

async function decryptContact(row, keyMaterial) {
  return {
    email: await decryptText(row.email_ciphertext, row.email_iv, keyMaterial),
    name:
      row.name_ciphertext && row.name_iv
        ? await decryptText(row.name_ciphertext, row.name_iv, keyMaterial)
        : "",
    organization:
      row.organization_ciphertext && row.organization_iv
        ? await decryptText(
            row.organization_ciphertext,
            row.organization_iv,
            keyMaterial,
          )
        : "",
    created_at: row.created_at ?? "",
  };
}

async function decryptText(ciphertext, iv, keyMaterial) {
  const key = await importAesKey(keyMaterial);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Decode(iv) },
    key,
    base64Decode(ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}

async function importAesKey(keyMaterial) {
  const bytes = await deriveBytes(keyMaterial, "email-encryption");

  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["decrypt"]);
}

async function deriveBytes(secret, purpose) {
  return crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${purpose}:${secret}`),
  );
}

function base64Decode(value) {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function writeCsv(contacts) {
  console.log(["email", "name", "organization", "created_at"].join(","));

  for (const contact of contacts) {
    console.log(
      [contact.email, contact.name, contact.organization, contact.created_at]
        .map(formatCsvValue)
        .join(","),
    );
  }
}

function formatCsvValue(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function printUsage() {
  console.error(
    `
Usage:
  EMAIL_ENCRYPTION_KEY=... npm run --silent interests:export -- --remote
  EMAIL_ENCRYPTION_KEY=... npm run --silent interests:export -- --local
  EMAIL_ENCRYPTION_KEY=... npm run --silent interests:export -- --input backup.json

Options:
  --format csv|json  Output format. Defaults to csv.
  --help             Show this help.
`.trim(),
  );
}
