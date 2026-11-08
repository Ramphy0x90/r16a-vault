-- Initial schema. Runs as the owner role, the runtime role only receives DML grants.

create table users (
  id                 uuid primary key default uuidv7(),
  username           text not null unique,
  auth_hash          text not null,
  kdf_salt           bytea not null check (octet_length(kdf_salt) = 16),
  kdf_opslimit       integer not null,
  kdf_memlimit       bigint not null,
  wrapped_vault_key  bytea not null check (octet_length(wrapped_vault_key) = 73),
  oidc_issuer        text,
  oidc_subject       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (oidc_issuer, oidc_subject)
);

create table sessions (
  id            uuid primary key default uuidv7(),
  user_id       uuid not null references users(id) on delete cascade,
  token_hash    bytea not null unique,
  state         text not null check (state in ('pre_auth', 'full')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  user_agent    text
);
create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

create table credentials (
  id          uuid primary key,
  user_id     uuid not null references users(id) on delete cascade,
  meta_ct     bytea not null check (octet_length(meta_ct) between 41 and 8192),
  secret_ct   bytea not null check (octet_length(secret_ct) between 41 and 8192),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index credentials_user_id_idx on credentials (user_id);

-- Keyed by an HMAC of the normalised username so the table never stores raw usernames,
-- and so unknown usernames are throttled exactly like real ones.
create table login_throttle (
  key_hash         bytea primary key check (octet_length(key_hash) = 32),
  failures         integer not null default 0,
  next_allowed_at  timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index login_throttle_updated_at_idx on login_throttle (updated_at);
