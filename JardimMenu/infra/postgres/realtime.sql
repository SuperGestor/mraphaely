-- Schema próprio do Realtime, criado antes de o serviço subir.
--
-- Fonte: supabase/supabase, docker/volumes/db/realtime.sql. O Realtime abre a conexão
-- com `SET search_path TO _realtime` (veja DB_AFTER_CONNECT_QUERY no compose) e roda as
-- migrações dele aqui dentro, separadas do schema public da aplicação.

\set pguser `echo "$POSTGRES_USER"`

create schema if not exists _realtime;
alter schema _realtime owner to :pguser;
