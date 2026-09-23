-- Senha dos papéis internos do Supabase, na criação do banco.
--
-- Fonte: supabase/supabase, docker/volumes/db/roles.sql. A imagem já cria os papéis; o
-- que falta é dar a eles a senha deste ambiente, que é a mesma POSTGRES_PASSWORD que o
-- compose entrega a cada serviço na string de conexão.
--
-- Roda UMA vez, quando o volume de dados nasce. Trocar a senha depois exige rodar estes
-- ALTER na mão, além de mudar o .env (está no README, seção de rotação).

\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator            WITH PASSWORD :'pgpass';
ALTER USER pgbouncer                WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin      WITH PASSWORD :'pgpass';
ALTER USER supabase_functions_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin   WITH PASSWORD :'pgpass';
