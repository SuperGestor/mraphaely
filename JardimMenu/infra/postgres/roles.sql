-- Senha dos papéis internos do Supabase, na criação do banco.
--
-- Fonte: supabase/supabase, docker/volumes/db/roles.sql. A imagem já cria os papéis; o
-- que falta é dar a eles a senha deste ambiente, que é a mesma POSTGRES_PASSWORD que o
-- compose entrega a cada serviço na string de conexão.
--
-- Roda UMA vez, quando o volume de dados nasce. Trocar a senha depois exige rodar estes
-- ALTER na mão, além de mudar o .env (está no README, seção de rotação).
--
-- POR QUE ISTO NÃO É UMA LISTA DE `ALTER USER` SOLTOS
--
-- O `migrate.sh` da imagem roda cada arquivo com `psql -v ON_ERROR_STOP=1`, e ele próprio
-- roda com `set -eu`. Um erro aqui não é um aviso: ele mata o resto da inicialização do
-- banco. Na primeira execução de verdade, em 23/09/2026, a linha
--
--     ALTER USER supabase_functions_admin WITH PASSWORD ...
--
-- derrubou tudo, porque esse papel não existe mais na imagem 17.6.1.167 (ele era das edge
-- functions, que estão fora de propósito nesta pilha). O estrago não ficou nela:
--
--   - a senha do supabase_storage_admin, na linha seguinte, nunca foi aplicada, e o
--     Storage entrou em laço de reinício com "password authentication failed";
--   - a senha do supabase_admin, aplicada pelo migrate.sh logo depois deste arquivo,
--     também não;
--   - a pasta `migrations/` da imagem inteira ficou sem rodar, então o banco nasceu sem o
--     schema `graphql_public` (o PostgREST recusou o cache de schema), sem o `_realtime`
--     (o Realtime entrou em laço de reinício) e com `auth.uid()` pertencendo a `postgres`
--     em vez de `supabase_auth_admin` (o GoTrue parou em "must be owner of function uid").
--
-- Quatro serviços de pé mancando por causa de um papel a mais numa lista. Por isso a
-- consulta abaixo: ela dá a senha a quem existe, ignora quem não existe, e não tem como
-- derrubar a inicialização se a próxima versão da imagem mexer nos papéis de novo.

\set pgpass `echo "$POSTGRES_PASSWORD"`

-- `\gexec` executa cada linha devolvida pela consulta. Nada é devolvido para papel que não
-- existe, então nada é executado por ele. O %L cuida das aspas da senha, e o %I do nome.
select format('alter user %I with password %L', rolname, :'pgpass')
  from pg_roles
 where rolname in (
         'authenticator',
         'pgbouncer',
         'supabase_auth_admin',
         'supabase_functions_admin',
         'supabase_storage_admin'
       )
 order by rolname
\gexec

-- Confere e diz o que ficou de fora, para aparecer no log da criação do banco. Se um papel
-- que os serviços usam sumir numa versão futura da imagem, isto avisa, em vez de o serviço
-- ficar reiniciando sem ninguém saber por quê.
do $$
declare
  faltando text[];
begin
  select array_agg(p order by p)
    into faltando
    from unnest(array['authenticator', 'supabase_auth_admin', 'supabase_storage_admin']) as p
   where not exists (select 1 from pg_roles where rolname = p);

  if faltando is not null then
    raise warning 'papéis que os serviços da pilha usam e NÃO existem nesta imagem: %', faltando;
  end if;
end $$;
