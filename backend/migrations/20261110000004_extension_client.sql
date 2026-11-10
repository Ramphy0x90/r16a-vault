-- Browser extension as a third client kind (docs/EXTENSION_SPEC.md section 8).

-- Which client created the session. Extension requests cannot set their own User-Agent, so
-- the session list needs this to name them. Sessions created before this migration stay
-- null and are described from their user agent as before.
alter table sessions
  add column client text check (client in ('web', 'mobile', 'extension'));

alter table oidc_flows drop constraint oidc_flows_client_check;
alter table oidc_flows
  add constraint oidc_flows_client_check check (client in ('web', 'mobile', 'extension'));

-- The extension's identity redirect URL, copied from the server's allowlist when the flow
-- starts. Mobile and web flows leave it null. The challenge column serves both app kinds.
alter table oidc_flows add column app_redirect text;
