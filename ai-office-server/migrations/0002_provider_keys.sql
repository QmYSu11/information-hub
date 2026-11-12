CREATE TABLE office_provider_keys (
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id, provider)
);
CREATE TABLE office_config_nonces (
  nonce TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX office_config_nonces_expiry ON office_config_nonces(expires_at);
