CREATE TABLE apps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  api_key_hash  text NOT NULL UNIQUE,  -- sha256 of the key; the raw key is shown once
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE endpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  url             text NOT NULL,
  description     text,
  secret          text NOT NULL,
  event_types     text[],                  -- NULL = subscribed to everything
  failure_streak  int NOT NULL DEFAULT 0,  -- consecutive failed attempts (circuit breaker)
  disabled_at     timestamptz,
  disabled_reason text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX endpoints_app_idx ON endpoints(app_id);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, idempotency_key)
);
CREATE INDEX messages_app_created_idx ON messages(app_id, created_at DESC);

CREATE TYPE delivery_status AS ENUM ('pending', 'succeeded', 'failed');

CREATE TABLE deliveries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  endpoint_id    uuid NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  status         delivery_status NOT NULL DEFAULT 'pending',
  attempt_count  int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, endpoint_id)
);
-- The sweeper only ever looks at pending rows; keep that index tiny.
CREATE INDEX deliveries_pending_idx ON deliveries(updated_at) WHERE status = 'pending';
CREATE INDEX deliveries_endpoint_idx ON deliveries(endpoint_id, created_at DESC);

CREATE TABLE attempts (
  id            bigserial PRIMARY KEY,
  delivery_id   uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  attempt_no    int NOT NULL,
  status_code   int,
  duration_ms   int NOT NULL,
  response_body text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attempts_delivery_idx ON attempts(delivery_id);
CREATE INDEX attempts_created_idx ON attempts(created_at);
