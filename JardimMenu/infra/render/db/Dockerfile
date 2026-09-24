# Postgres do Jardim Menu no Render (Private Service, um disco em /var/lib/postgresql/data).
#
# POR QUE ESTA IMAGEM EXISTE
#
# Restrição do Render: não existe bind mount. O infra/docker-compose.yml monta três
# arquivos dentro de /docker-entrypoint-initdb.d; no Render eles precisam estar ASSADOS na
# imagem. Sem eles o banco nasce quebrado, e cada um de um jeito diferente:
#   - sem roles.sql   -> authenticator, supabase_auth_admin e supabase_storage_admin ficam
#                        sem a senha do ambiente, e PostgREST, GoTrue e Storage entram em
#                        laço de reinício com "password authentication failed";
#   - sem jwt.sql     -> app.settings.jwt_exp não existe no banco;
#   - sem realtime.sql-> o schema _realtime não existe e o Realtime não sobe.
#
# O Postgres gerenciado do Render não substitui isto: faltam pgtap, pg_graphql e pgsodium,
# o papel não é superusuário e a replicação lógica é restrita. O banco é contêiner nosso.
#
# CONTEXTO DE BUILD: JardimMenu/infra (e NÃO esta pasta), porque os três .sql moram em
# infra/postgres/ e são os MESMOS arquivos que o compose usa — uma cópia só, sem chance de
# divergirem. Ou seja:
#
#   cd JardimMenu/infra && docker build -f render/db/Dockerfile -t jardim-db-render:local .
#
# Na configuração do serviço do Render: raiz do build = JardimMenu/infra,
# caminho do Dockerfile = JardimMenu/infra/render/db/Dockerfile.
#
# NENHUM `ARG` É DECLARADO AQUI, E ISSO É PROPOSITAL. O Render transforma toda variável de
# ambiente do serviço em build arg automaticamente, e POSTGRES_PASSWORD é uma delas. Um
# `ARG POSTGRES_PASSWORD` gravaria o valor no histórico da imagem (`docker history`), o que
# a regra 4 do CLAUDE.md proíbe. Sem o ARG declarado, o build arg simplesmente não é
# consumido e não entra em camada nenhuma. Por isso, inclusive, a versão da imagem base
# está escrita por extenso aqui embaixo, e não em variável.

# Versão fixada por decisão (NF-018: atualização controlada). Ela aparece também em
# VERSAO_POSTGRES nos infra/ambientes/*.env.exemplo, que é o que o compose usa. As duas
# mudam juntas, e a troca passa por staging antes.
FROM public.ecr.aws/supabase/postgres:17.6.1.167

# Os três scripts que o compose monta como bind, com os mesmos nomes e a mesma pasta.
#
# O /docker-entrypoint-initdb.d/migrate.sh da imagem roda `init-scripts/*.sql` e depois
# `migrations/*.sql`, cada um com `psql -v ON_ERROR_STOP=1`, e ele próprio roda com
# `set -eu`: um erro em qualquer um mata o resto da criação do banco. O prefixo 99- põe os
# nossos por último, depois do 00-schema.sql e do 00-extension.sql que a imagem já traz.
#
# O CONTEÚDO DELES NÃO É ALTERADO AQUI. O roles.sql em especial foi reescrito em 23/09/2026
# depois de um defeito que derrubou a criação inteira do banco; o cabeçalho dele conta a
# história e explica por que ele dá senha a quem existe em vez de listar ALTER USER soltos.
COPY --chown=postgres:postgres postgres/roles.sql    /docker-entrypoint-initdb.d/init-scripts/99-roles.sql
COPY --chown=postgres:postgres postgres/jwt.sql      /docker-entrypoint-initdb.d/init-scripts/99-jwt.sql
COPY --chown=postgres:postgres postgres/realtime.sql /docker-entrypoint-initdb.d/migrations/99-realtime.sql

# O entrypoint que põe a chave do pgsodium dentro do disco. O porquê está no cabeçalho dele.
# O chmod é um RUN separado de propósito: `COPY --chmod` exige BuildKit, e quem faz o build
# aqui pode ser o Render, a máquina de alguém no Windows (onde o modo do arquivo no git não
# manda) ou a esteira. Assim o bit de execução não depende de nenhum dos três.
COPY render/db/entrypoint.sh /usr/local/bin/jardim-entrypoint.sh
RUN chmod 0755 /usr/local/bin/jardim-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/jardim-entrypoint.sh"]

# O CMD precisa ser repetido: declarar ENTRYPOINT zera o CMD herdado da imagem base.
# Estes são os mesmos argumentos que o `command:` do infra/docker-compose.yml passa, para o
# Render rodar o banco exatamente como ele roda na máquina de quem desenvolve. O
# log_min_messages=fatal existe porque sem ele o log enche com as consultas de polling do
# Realtime — e log cheio de ruído é log que ninguém lê quando importa.
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf", "-c", "log_min_messages=fatal"]
