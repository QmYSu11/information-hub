CREATE TABLE office_chat_conversations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  lock_request_id TEXT,
  lock_until INTEGER,
  context_message_count INTEGER NOT NULL DEFAULT 0,
  context_limited INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX office_chat_owner_updated ON office_chat_conversations(owner_id, updated_at);
CREATE TABLE office_chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivery_status TEXT NOT NULL,
  model TEXT,
  usage_json TEXT,
  materials_json TEXT NOT NULL DEFAULT '[]',
  references_json TEXT NOT NULL DEFAULT '[]',
  intent TEXT NOT NULL DEFAULT 'general',
  watch_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE(conversation_id, ordinal)
);
CREATE INDEX office_chat_messages_conversation ON office_chat_messages(conversation_id, ordinal);
CREATE TABLE office_chat_requests (
  owner_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  error_json TEXT,
  PRIMARY KEY(owner_id, request_id)
);
CREATE INDEX office_chat_requests_conversation ON office_chat_requests(conversation_id);
