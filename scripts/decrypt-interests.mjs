import { readFile } from "node:fs/promises";

const [, , inputPath] = process.argv;
const secret = process.env.EMAIL_ENCRYPTION_KEY;

if (!inputPath || !secret) {
  console.error(
    "Usage: EMAIL_ENCRYPTION_KEY=... npm run interests:decrypt -- backup.json",
  );
  process.exit(1);
}

const backup = JSON.parse(await readFile(inputPath, "utf8"));
const rows = Array.isArray(backup.rows) ? backup.rows : backup;

console.log(["email", "name", "organization", "created_at"].join(","));

for (const row of rows) {
  const email = await decryptText(row.email_ciphertext, row.email_iv, secret);
  const name =
    row.name_ciphertext && row.name_iv
      ? await decryptText(row.name_ciphertext, row.name_iv, secret)
      : "";
  const organization =
    row.organization_ciphertext && row.organization_iv
      ? await decryptText(
          row.organization_ciphertext,
          row.organization_iv,
          secret,
        )
      : "";

  console.log(
    [email, name, organization, row.created_at ?? ""]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(","),
  );
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
