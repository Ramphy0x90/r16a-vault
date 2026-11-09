-- One time setup on the shared PostgreSQL in r16a-databases, run as a superuser like this
--   kubectl -n r16a-databases exec -i deploy/postgres -- psql -U postgres \
--     -v owner_pw='...' -v app_pw='...' < provision.sql
-- Passwords come in as psql variables so they never live in this file.
--
-- r16a_vault_owner owns the schema and is used only by the migrate init container.
-- r16a_vault_app is the runtime role. It owns nothing and can only read and write rows, so
-- a compromised backend cannot alter or drop the schema.

create role r16a_vault_owner login password :'owner_pw' nosuperuser nocreatedb nocreaterole;
create role r16a_vault_app login password :'app_pw' nosuperuser nocreatedb nocreaterole;
create database r16a_vault owner r16a_vault_owner;
revoke all on database r16a_vault from public;
grant connect on database r16a_vault to r16a_vault_app;

\connect r16a_vault

alter schema public owner to r16a_vault_owner;
revoke create on schema public from public;
grant usage on schema public to r16a_vault_app;
alter default privileges for role r16a_vault_owner in schema public
  grant select, insert, update, delete on tables to r16a_vault_app;
alter default privileges for role r16a_vault_owner in schema public
  grant usage, select on sequences to r16a_vault_app;
