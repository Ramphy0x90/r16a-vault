#!/bin/sh
# Creates the owner and runtime roles on first database start. Passwords arrive as psql
# variables and are quoted by psql itself, so they cannot break out of the statement.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$R16A_OWNER_PASSWORD" -v app_pw="$R16A_APP_PASSWORD" <<'SQL'
create role r16a_owner login password :'owner_pw' nosuperuser nocreatedb nocreaterole;
create role r16a_app login password :'app_pw' nosuperuser nocreatedb nocreaterole;
create database r16a owner r16a_owner;
revoke all on database r16a from public;
grant connect on database r16a to r16a_app;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname r16a <<'SQL'
alter schema public owner to r16a_owner;
revoke create on schema public from public;
grant usage on schema public to r16a_app;
alter default privileges for role r16a_owner in schema public
  grant select, insert, update, delete on tables to r16a_app;
alter default privileges for role r16a_owner in schema public
  grant usage, select on sequences to r16a_app;
SQL
