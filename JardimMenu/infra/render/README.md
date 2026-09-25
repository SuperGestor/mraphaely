# Imagens próprias para o Render

Decisão de 24/09/2026: a pilha do Supabase vai para o **Render**, em contêineres, e o front
vai para o **Netlify**. Esta pasta existe **ao lado** do `infra/docker-compose.yml`, que
continua sendo o que roda na máquina de quem desenvolve e o que a esteira usa. Nada aqui
substitui aquele arquivo.

## Por que duas imagens próprias

O Render **não roda `docker compose`** (cada contêiner vira um serviço) e, sobretudo,
**não faz bind mount**. Dos sete serviços da pilha, cinco sobem direto da imagem pública
(`auth`, `rest`, `realtime`, `storage`, `meta`). Os outros dois montam arquivo de
configuração no compose, e por isso precisam de imagem nossa, com o arquivo **assado**
dentro:

| pasta | serviço no Render | o que assa | o que o compose montava |
| --- | --- | --- | --- |
| `db/` | Private Service, um disco em `/var/lib/postgresql/data` | `infra/postgres/{roles,jwt,realtime}.sql` | três bind mounts em `/docker-entrypoint-initdb.d` |
| `kong/` | **Web Service** (o único público) | `infra/kong/kong.yml` | um bind mount em `/home/kong/temp.yml` |

Os `.sql` e o `kong.yml` **não são copiados para cá**: as duas imagens leem os originais
de `infra/`. Existe uma cópia só de cada arquivo, e é por isso que o contexto de build é
`JardimMenu/infra`, e não esta pasta.

## `db/` — Postgres

`FROM public.ecr.aws/supabase/postgres:17.6.1.167`, os três `.sql` assados com prefixo
`99-` (o `migrate.sh` da imagem roda a pasta em ordem alfabética, e os nossos vêm por
último), mais um entrypoint com **uma** responsabilidade: garantir que
`/etc/postgresql-custom/pgsodium_root.key` seja um link simbólico para dentro do disco de
dados.

Isso existe porque no Render **um serviço tem no máximo um disco**, e o compose usa dois
(`db-dados` e `db-config`). Hoje perder a chave não custa nada — nada no nosso schema é
cifrado, e ficou medido em 24/09/2026 que um contêiner novo sobre o mesmo disco reabre o
banco intacto mesmo com a chave trocada. O entrypoint é para o dia em que alguém usar o
Vault ou o pgsodium: a partir daí a chave **é** o dado. O cabeçalho do
`db/entrypoint.sh` conta isso por extenso.

O conteúdo dos três `.sql` não é alterado — o `roles.sql` foi reescrito em 23/09/2026
depois de um defeito que derrubou a criação inteira do banco, e o cabeçalho dele explica
por quê.

## `kong/` — porta de entrada da API

`FROM kong:2.8.1`, com o `kong.yml` assado como **modelo** em `/home/kong/temp.yml`. O
entrypoint reproduz o do compose (`eval "echo \"$(cat ...)\"" > kong.yml`), que expande as
variáveis do ambiente dentro do YAML — por isso o `kong.yml` continua sem poder ter aspas
duplas nem crase, nem em comentário.

Três diferenças em relação ao compose, todas por causa do Render: caminhos absolutos em vez
de `~`; o Kong passa a escutar na porta que chega em `PORT`; e **a subida para se qualquer
variável usada no `kong.yml` chegar vazia**, porque uma chave vazia viraria `key:` sem
valor e a porta da API subiria com o controle de acesso em estado que ninguém escolheu.

Variáveis que o serviço precisa entregar: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`,
`REALTIME_HOST` (o nome interno do Private Service do Realtime naquele ambiente) e
`CORS_ORIGENS` (a origem do front no Netlify). A configuração estrutural do Kong
(`KONG_DNS_ORDER`, plugins, buffers, IPs confiáveis) está assada na imagem; segredo, nunca.

## Construir e testar na máquina

Sempre a partir de `JardimMenu/infra`:

```sh
cd JardimMenu/infra
docker build -f render/db/Dockerfile   -t jardim-db-render:local   .
docker build -f render/kong/Dockerfile -t jardim-kong-render:local .
```

**Banco, criação e reabertura** (um volume só, como no Render):

```sh
docker volume create jardim-db-teste
docker run -d --name jardim-db-teste \
  -v jardim-db-teste:/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=trocar -e PGPASSWORD=trocar -e JWT_EXP=3600 \
  jardim-db-render:local

# os três .sql rodaram?  devem aparecer auth, storage, graphql, graphql_public,
# realtime, extensions e _realtime
docker exec jardim-db-teste psql -U postgres -c '\dn'
docker exec jardim-db-teste psql -U postgres -c 'show app.settings.jwt_exp'

# a chave está no disco, via link, com 0640 e dono postgres?
docker exec jardim-db-teste ls -l /etc/postgresql-custom/pgsodium_root.key
docker exec jardim-db-teste ls -l /var/lib/postgresql/data/pgsodium_root.key

# guarde a impressão digital (NUNCA a chave) para comparar depois
docker exec jardim-db-teste sha256sum /var/lib/postgresql/data/pgsodium_root.key
```

Depois **derrube o contêiner, suba outro com o mesmo volume** e repita o `sha256sum`: é
isso que um deploy do Render faz, e a impressão digital tem de ser a mesma.

**Kong, sem a pilha de pé.** Sem variável nenhuma ele tem de morrer dizendo quais faltam:

```sh
docker run --rm jardim-kong-render:local
```

Com as variáveis, o `kong config parse` valida o YAML já expandido:

```sh
docker run --rm \
  -e SUPABASE_ANON_KEY=exemplo-anon \
  -e SUPABASE_SERVICE_KEY=exemplo-service \
  -e REALTIME_HOST=realtime \
  -e CORS_ORIGENS=https://exemplo.netlify.app \
  jardim-kong-render:local kong config parse /home/kong/kong.yml
```

## O que NÃO está nesta pasta

A definição dos serviços (`render.yaml` ou o painel), o disco do Storage, os dois ambientes
de NF-012 e o front no Netlify. Três coisas para quem escrever isso:

- o Private Service do banco precisa do disco em `/var/lib/postgresql/data`. Se o ponto de
  montagem chegar com um `lost+found` dentro, o `initdb` recusa o diretório ("exists but is
  not empty") e o **primeiro** deploy falha; a saída é apontar `PGDATA` para uma subpasta
  do disco, e o entrypoint daqui já acompanha o `PGDATA` sozinho;
- o health check do Web Service do Kong não pode cair numa rota protegida por `key-auth`:
  o Render não manda cabeçalho, e sem `apikey` a resposta é 401 para sempre;
- `REALTIME_HOST` e as URLs públicas mudam por ambiente, e staging e produção não
  compartilham nada (NF-012).

## O que foi verificado, em 25/09/2026

As duas imagens foram construídas e executadas nesta máquina, com Docker. O que segue tem
saída de comando por trás; o que não está aqui **não foi verificado**.

**A imagem do banco (`render/db`)**

| Verificação | Resultado |
|---|---|
| `docker build` | ok |
| Sobe com UM disco só, montado em `/var/lib/postgresql/data` | `accepting connections` |
| Os três `.sql` assados rodam na criação | `99-jwt.sql`, `99-roles.sql` e `99-realtime.sql` no log, sem erro |
| O banco nasce completo | 5 schemas (`auth`, `storage`, `graphql_public`, `realtime`, `_realtime`) e 6 papéis |
| A chave do pgsodium vira link para dentro do disco | `-> /var/lib/postgresql/data/pgsodium_root.key` |
| **Contêiner NOVO sobre o MESMO disco**, que é o que um deploy do Render faz | a chave continua a mesma (sha idêntico) e o dado escrito antes do "deploy" está lá |

Esse último é o que importa: com a imagem original do Supabase a chave era regerada
diferente a cada contêiner novo. Hoje isso não quebra nada, porque nada no schema é cifrado
— mas no dia em que alguém usar o Vault, perder a chave perde o dado, e ninguém vai lembrar
desta conversa.

**A imagem do Kong (`render/kong`)**

Testada com hostnames **diferentes** dos padrões do compose, que é exatamente o caso do
Render: `AUTH_HOST=jardim-staging-auth`, `REST_HOST=jardim-staging-rest`,
`STORAGE_HOST=jardim-staging-storage`.

| Verificação | Resultado |
|---|---|
| `docker build` | ok |
| Sobe e fica saudável | `Up (healthy)` |
| O `kong.yml` expandido usa os nomes novos | `http://jardim-staging-auth:9999/…`, `http://jardim-staging-rest:3000/` |
| A API responde por ele | `/rest/v1/` 200, `/auth/v1/health` 200 |
| A regra 2 continua valendo | `anon` tentando inserir mesa: recusado pela RLS, HTTP 401 |

**O que NÃO foi verificado, e só a conta do Render prova:** o blueprint em si (campos,
nomes internos da rede privada, disco, health check), o nome do tenant do Realtime no
subdomínio, e o comportamento do deploy com disco (que derruba o serviço por alguns
instantes).
