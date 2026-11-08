-- Credential ids are unique per owner instead of globally. A client chosen id that happens to
-- exist in another account no longer collides, so a conflict reveals nothing about other
-- users. The AEAD associated data binds each blob to its id under that owner's vault key.
alter table credentials drop constraint credentials_pkey;
alter table credentials add primary key (user_id, id);
-- The primary key now starts with user_id and serves every per user lookup.
drop index credentials_user_id_idx;
