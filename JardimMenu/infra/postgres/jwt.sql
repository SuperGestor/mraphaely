-- Validade do token de login, visível para o banco.
--
-- Fonte: supabase/supabase, docker/volumes/db/jwt.sql. O valor vem de JWT_EXPIRY no .env
-- do ambiente, o mesmo que o GoTrue usa em GOTRUE_JWT_EXP.

\set jwt_exp `echo "$JWT_EXP"`

ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
