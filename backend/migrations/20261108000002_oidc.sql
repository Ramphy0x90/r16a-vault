-- OIDC sign in (SPEC 4.10). Every row is short lived and removed by the cleanup task.

-- One row per authorization request, keyed by a hash of the state parameter.
create table oidc_flows (
  state_hash        bytea primary key check (octet_length(state_hash) = 32),
  nonce             text not null,
  pkce_verifier     text not null,
  client            text not null check (client in ('web', 'mobile')),
  -- Hash of a random value held in a browser cookie, which binds a web flow to the browser
  -- that started it and stops login CSRF.
  browser_binding   bytea,
  -- S256 challenge from the mobile app, checked when it redeems its one time code.
  mobile_challenge  text,
  expires_at        timestamptz not null
);

-- A verified identity that has no account yet. The holder of the token may register once.
create table oidc_pending (
  token_hash          bytea primary key check (octet_length(token_hash) = 32),
  issuer              text not null,
  subject             text not null,
  suggested_username  text,
  expires_at          timestamptz not null
);

-- One time codes handed to the mobile app through its custom URL scheme.
create table oidc_exchange_codes (
  code_hash           bytea primary key check (octet_length(code_hash) = 32),
  challenge           text not null,
  kind                text not null check (kind in ('pre_auth', 'pending')),
  session_id          uuid references sessions(id) on delete cascade,
  issuer              text,
  subject             text,
  suggested_username  text,
  expires_at          timestamptz not null
);

create index oidc_flows_expires_idx on oidc_flows (expires_at);
create index oidc_pending_expires_idx on oidc_pending (expires_at);
create index oidc_exchange_codes_expires_idx on oidc_exchange_codes (expires_at);
