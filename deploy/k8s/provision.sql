-- One time setup on the existing PostgreSQL instance, run as a superuser like this
--   psql -v owner_pw='...' -v app_pw='...' -f provision.sql
-- Passwords come in as psql variables so they never live in this file.
--
-- r16a_owner owns the schema and is used only by the migration job.
-- r16a_app is the runtime role. It owns nothing and can only read and write rows, so a
-- compromised backend cannot alter or drop the schema.

create role r16a_owner login password :'owner_pw' nosuperuser nocreatedb nocreaterole;
create role r16a_app login password :'app_pw' nosuperuser nocreatedb nocreaterole;
create database r16a owner r16a_owner;
revoke all on database r16a from public;
grant connect on database r16a to r16a_app;

\connect r16a

alter schema public owner to r16a_owner;
revoke create on schema public from public;
grant usage on schema public to r16a_app;
alter default privileges for role r16a_owner in schema public
  grant select, insert, update, delete on tables to r16a_app;
alter default privileges for role r16a_owner in schema public
  grant usage, select on sequences to r16a_app;
