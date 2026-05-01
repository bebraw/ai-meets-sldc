export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/interest") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return handleInterest(request, env);
    }

    const response = await env.ASSETS.fetch(request);

    if (response.headers.get("content-type")?.includes("text/html")) {
      return injectRuntimeConfig(response, env);
    }

    return response;
  },

  async scheduled(_event, env, ctx) {
    if (!env.INTEREST_BACKUPS) return;

    ctx.waitUntil(backupInterests(env));
  },
};

async function handleInterest(request, env) {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Interest storage is not configured" }, 503);
  }

  if (!env.EMAIL_ENCRYPTION_KEY) {
    return jsonResponse({ error: "Encryption is not configured" }, 503);
  }

  const formData = await request.formData();
  const email = normalizeEmail(formData.get("email"));
  const name = normalizeOptionalText(formData.get("name"), 120);
  const organization = normalizeOptionalText(formData.get("organization"), 160);
  const consent = formData.get("consent") === "yes";
  const turnstileToken = normalizeOptionalText(
    formData.get("cf-turnstile-response"),
    4096,
  );

  if (!email || !isLikelyEmail(email)) {
    return jsonResponse({ error: "Enter a valid email address" }, 400);
  }

  if (!consent) {
    return jsonResponse({ error: "Consent is required" }, 400);
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const turnstileOk = await verifyTurnstile({
      request,
      secret: env.TURNSTILE_SECRET_KEY,
      token: turnstileToken,
    });

    if (!turnstileOk) {
      return jsonResponse({ error: "Verification failed" }, 400);
    }
  }

  const keyMaterial = env.EMAIL_ENCRYPTION_KEY;
  const emailHash = await hashEmail(email, keyMaterial);
  const encryptedEmail = await encryptText(email, keyMaterial);
  const encryptedName = name ? await encryptText(name, keyMaterial) : null;
  const encryptedOrganization = organization
    ? await encryptText(organization, keyMaterial)
    : null;
  const consentText =
    "I agree to be contacted about AI meets SDLC seminar registration.";
  const createdAt = new Date().toISOString();

  try {
    await env.INTERESTS.prepare(
      `INSERT INTO interests (
        email_hash,
        email_ciphertext,
        email_iv,
        name_ciphertext,
        name_iv,
        organization_ciphertext,
        organization_iv,
        consent_text,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        emailHash,
        encryptedEmail.ciphertext,
        encryptedEmail.iv,
        encryptedName?.ciphertext ?? null,
        encryptedName?.iv ?? null,
        encryptedOrganization?.ciphertext ?? null,
        encryptedOrganization?.iv ?? null,
        consentText,
        createdAt,
      )
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return jsonResponse({
        ok: true,
        duplicate: true,
        message: "You are already on the interest list.",
      });
    }

    throw error;
  }

  return jsonResponse({
    ok: true,
    message: "Thanks. We will notify you when registration opens.",
  });
}

async function verifyTurnstile({ request, secret, token }) {
  if (!token) return false;

  const payload = new FormData();
  payload.append("secret", secret);
  payload.append("response", token);

  const ip = request.headers.get("CF-Connecting-IP");

  if (ip) {
    payload.append("remoteip", ip);
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: payload,
    },
  );
  const outcome = await response.json();

  return outcome.success === true;
}

async function backupInterests(env) {
  const { results } = await env.INTERESTS.prepare(
    "SELECT * FROM interests ORDER BY created_at ASC",
  ).all();
  const body = JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      rows: results,
    },
    null,
    2,
  );
  const key = `interests/${new Date().toISOString().slice(0, 10)}.json`;

  await env.INTEREST_BACKUPS.put(key, body, {
    httpMetadata: { contentType: "application/json" },
  });
}

async function injectRuntimeConfig(response, env) {
  const html = await response.text();

  return new Response(
    html.replaceAll("__TURNSTILE_SITE_KEY__", env.TURNSTILE_SITE_KEY ?? ""),
    response,
  );
}

async function encryptText(value, keyMaterial) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(keyMaterial);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );

  return {
    ciphertext: base64Encode(new Uint8Array(ciphertext)),
    iv: base64Encode(iv),
  };
}

async function hashEmail(email, keyMaterial) {
  const key = await importHmacKey(keyMaterial);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(email),
  );

  return base64Encode(new Uint8Array(signature));
}

async function importAesKey(keyMaterial) {
  const bytes = await deriveBytes(keyMaterial, "email-encryption");

  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt"]);
}

async function importHmacKey(keyMaterial) {
  const bytes = await deriveBytes(keyMaterial, "email-hash");

  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function deriveBytes(secret, purpose) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${purpose}:${secret}`),
  );

  return digest;
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeOptionalText(value, maxLength) {
  if (typeof value !== "string") return "";

  return value.trim().slice(0, maxLength);
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function base64Encode(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
