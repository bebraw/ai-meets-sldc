CREATE TABLE IF NOT EXISTS interests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash TEXT NOT NULL UNIQUE,
  email_ciphertext TEXT NOT NULL,
  email_iv TEXT NOT NULL,
  name_ciphertext TEXT,
  name_iv TEXT,
  organization_ciphertext TEXT,
  organization_iv TEXT,
  consent_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interests_created_at ON interests (created_at);
