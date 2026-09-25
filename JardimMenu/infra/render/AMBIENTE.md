# Subir a pilha no Render, pela primeira vez

Este é o passo a passo de quem vai criar os dois ambientes do Jardim Menu no Render, do
zero. O arquivo que descreve os serviços é o `infra/render/render.yaml`, ao lado deste; o
porquê das duas imagens próprias está no `infra/render/README.md`; o front está no
`infra/render/NETLIFY.md`.

**Nada do que está escrito aqui foi executado.** Não há conta do Render nesta máquina. O
que foi construído e rodado de verdade são as duas imagens (`render/db` e `render/kong`), e
o que elas provaram está na última seção do `README.md`. Onde este documento diz "confira",
é porque só a conta prova.

Leia a seção **O que só a conta do Render decide** antes de começar: há três pontos que
podem mudar o que você vai fazer.

---

## 0. Antes de abrir o Render

Tenha em mãos:

- **o repositório conectado ao Render** (o `SuperGestor`, com o `JardimMenu/` dentro);
- **o endereço do front no Netlify** de cada ambiente, ou pelo menos a decisão de qual vai
  ser. Ele entra no CORS da API e na lista de redirecionamento do login, e sem ele o
  navegador recusa toda chamada — mesmo com a pilha inteira de pé;
- **Node na máquina**, para rodar o gerador de segredos (nenhuma dependência a instalar);
- **um lugar seguro para guardar dois arquivos de segredo** (gerenciador de senhas). Eles
  não vão para o git, não vão para conversa e não vão para e-mail.

Decida também o **nome dos serviços**. Os nomes do `render.yaml` são
`jardim-staging-*` e `jardim-producao-*`. Se você mudar algum, mude também as referências
`fromService` e `fromGroup` que apontam para ele — o blueprint recusa o sync com nome que
não existe, então o erro aparece na hora, mas é chato.

---

## 1. Gerar os segredos, um ambiente de cada vez

O `infra/scripts/gerar-segredos.mjs` já existe e serve inteiro. Ele sorteia a senha do
Postgres, o `JWT_SECRET`, **assina** as chaves `anon` e `service_role` com esse segredo
(elas são JWT HS256; não adianta sortear uma chave solta) e sorteia os três segredos
menores. É por isso que o `render.yaml` não usa `generateValue` em lugar nenhum.

O endereço público da API neste desenho é a URL do Web Service do Kong. Se o nome do
serviço estiver livre no Render, ela é previsível:

```
staging   →  https://jardim-staging-kong.onrender.com
produção  →  https://jardim-producao-kong.onrender.com
```

Rode, fora da pasta do repositório (o arquivo é segredo):

```sh
node JardimMenu/infra/scripts/gerar-segredos.mjs \
  --ambiente staging \
  --dominio-api jardim-staging-kong.onrender.com \
  --dominio-app SEU-SITE-STAGING.netlify.app \
  --saida ~/segredos-jardim/staging.env

node JardimMenu/infra/scripts/gerar-segredos.mjs \
  --ambiente producao \
  --dominio-api jardim-producao-kong.onrender.com \
  --dominio-app SEU-SITE.netlify.app \
  --saida ~/segredos-jardim/producao.env
```

> **Duas execuções, dois conjuntos de segredos.** Staging e produção não compartilham nada
> (NF-012). Nunca copie uma chave de um para o outro.

> **Não rode de novo depois.** Chave nova significa que todo tablet pareado e toda sessão
> da equipe param de falar com a API, e que o front precisa ser construído outra vez (as
> `NEXT_PUBLIC_` entram no bundle no build). O próprio script recusa sobrescrever sem
> `--forcar`.

> Se o Render acabar dando outro endereço ao Kong (nome já em uso), **não rode o gerador de
> novo**: só corrija à mão, no painel, as quatro variáveis de endereço da etapa 5. Nenhuma
> chave depende do endereço.

### De onde sai cada coisa

| No `.env` gerado | Onde entra no Render |
| --- | --- |
| `POSTGRES_PASSWORD` | grupo `jardim-<amb>-banco` (as quatro chaves) |
| `JWT_SECRET` | grupo `jardim-<amb>-jwt` (as cinco chaves) |
| `ANON_KEY` | grupo `jardim-<amb>-chaves`: `SUPABASE_ANON_KEY` e `ANON_KEY` |
| `SERVICE_ROLE_KEY` | grupo `jardim-<amb>-chaves`: `SUPABASE_SERVICE_KEY` e `SERVICE_KEY` |
| `SECRET_KEY_BASE` | serviço `realtime`, variável `SECRET_KEY_BASE` |
| `REALTIME_DB_ENC_KEY` | serviço `realtime`, variável `DB_ENC_KEY` |
| `PG_META_CRYPTO_KEY` | serviço `meta`, variável `CRYPTO_KEY` |
| `API_EXTERNAL_URL` | `auth`: `API_EXTERNAL_URL` **e** `GOTRUE_JWT_ISSUER`; `storage`: `STORAGE_PUBLIC_URL` |
| `SITE_URL` | `auth`: `GOTRUE_SITE_URL` |
| `ADDITIONAL_REDIRECT_URLS` | `auth`: `GOTRUE_URI_ALLOW_LIST` |
| `CORS_ORIGENS` | `kong`: `CORS_ORIGENS` |
| `SMTP_*` | `auth`: `GOTRUE_SMTP_*` (preencha no arquivo antes, ou direto no painel) |
| `NEXT_PUBLIC_*` | Netlify, não Render — veja o `NETLIFY.md` |

**O que o `.env` traz e o Render não usa:** `PROJETO`, `AMBIENTE`, `REDE_BORDA`,
`IMAGEM_APP`, `TAG_APP` (coisas do compose e do servidor próprio), `POSTGRES_DB`,
`POSTGRES_PORT`, `STORAGE_TENANT_ID`, `REGION`, `GLOBAL_S3_BUCKET` e os `VERSAO_*` (já
estão escritos no `render.yaml` e nas imagens), e os `ALERT_*` (são do app, no Netlify).

**`JWT_EXPIRY` é o único número repetido em três lugares do `render.yaml`:** `JWT_EXP` no
banco, `GOTRUE_JWT_EXP` no auth e `PGRST_APP_SETTINGS_JWT_EXP` no rest. Estão todos em
`3600`, que é o padrão do gerador. Se um dia mudar, mude os três.

---

## 2. Criar os seis grupos de variáveis — **antes** do blueprint

No painel do Render: **Env Groups → New Environment Group**. Seis grupos, três por
ambiente. Os nomes precisam ser exatamente estes, porque é assim que o `render.yaml` os
chama:

**`jardim-staging-banco`** e **`jardim-producao-banco`** — as quatro chaves com o **mesmo**
valor, a `POSTGRES_PASSWORD` daquele ambiente:

```
POSTGRES_PASSWORD      PGPASSWORD      DB_PASSWORD      PG_META_DB_PASSWORD
```

**`jardim-staging-jwt`** e **`jardim-producao-jwt`** — as cinco chaves com o **mesmo**
valor, o `JWT_SECRET` daquele ambiente:

```
GOTRUE_JWT_SECRET   PGRST_JWT_SECRET   AUTH_JWT_SECRET   API_JWT_SECRET   METRICS_JWT_SECRET
```

**`jardim-staging-chaves`** e **`jardim-producao-chaves`** — quatro chaves, dois valores:

```
SUPABASE_ANON_KEY    = ANON_KEY
ANON_KEY             = ANON_KEY
SUPABASE_SERVICE_KEY = SERVICE_ROLE_KEY
SERVICE_KEY          = SERVICE_ROLE_KEY
```

**Por que grupo, e por que nomes repetidos.** O mesmo `JWT_SECRET` é pedido por quatro
serviços com cinco nomes diferentes. Colar cinco vezes é cinco chances de errar um
caractere — e um caractere errado não derruba nada: faz um pedaço da API recusar token
depois, sem dizer por quê. No grupo, cola-se uma vez só. O preço é que cada serviço ligado
ao grupo enxerga os cinco nomes e lê só o que lhe interessa; dentro desta pilha, que é toda
do mesmo dono, isso é aceitável e está dito no `render.yaml`.

**Por que antes.** A documentação do Render diz que variável de grupo **não pode** ser
`sync: false`. Um grupo declarado dentro do `render.yaml` teria de trazer o valor escrito,
e o arquivo é versionado. Por isso os grupos nascem no painel e o blueprint só os
referencia pelo nome.

> **Confira ao terminar:** os seis grupos existem, com os valores certos, e **nenhum deles
> está ligado a serviço nenhum à mão**. Quem liga é o blueprint.

---

## 3. Criar o blueprint

**New → Blueprint Instance**, escolha o repositório e, no campo do caminho do arquivo
("Blueprint Path"), informe:

```
JardimMenu/infra/render/render.yaml
```

O Render vai ler o arquivo e **pedir o valor de cada variável `sync: false`**. São 17 por
ambiente. Preencha assim:

| Variável | O que colar agora |
| --- | --- |
| `auth` · `API_EXTERNAL_URL` | `https://jardim-<amb>-kong.onrender.com` |
| `auth` · `GOTRUE_JWT_ISSUER` | o **mesmo** valor de `API_EXTERNAL_URL` |
| `auth` · `GOTRUE_SITE_URL` | `https://<site>.netlify.app` |
| `auth` · `GOTRUE_URI_ALLOW_LIST` | `https://<site>.netlify.app/**` |
| `auth` · `GOTRUE_SMTP_ADMIN_EMAIL`, `_HOST`, `_USER`, `_PASS` | o SMTP, ou vazio por enquanto |
| `rest` · `PGRST_DB_URI` | **`preencher`** (etapa 5) |
| `auth` · `GOTRUE_DB_DATABASE_URL` | **`preencher`** (etapa 5) |
| `storage` · `DATABASE_URL` | **`preencher`** (etapa 5) |
| `storage` · `POSTGREST_URL` | **`preencher`** (etapa 5) |
| `storage` · `STORAGE_PUBLIC_URL` | `https://jardim-<amb>-kong.onrender.com` |
| `realtime` · `DB_ENC_KEY` | `REALTIME_DB_ENC_KEY` do `.env` |
| `realtime` · `SECRET_KEY_BASE` | `SECRET_KEY_BASE` do `.env` |
| `meta` · `CRYPTO_KEY` | `PG_META_CRYPTO_KEY` do `.env` |
| `kong` · `CORS_ORIGENS` | `https://<site>.netlify.app` |

As quatro marcadas **`preencher`** são as que dependem do nome interno do banco e do
PostgREST na rede privada — e esse nome **não é o nome do serviço**: o Render acrescenta um
sufixo próprio (`jardim-staging-db-XXXX`), que só existe depois que o serviço é criado.
Colocar um texto qualquer agora é de propósito: o serviço sobe, não consegue conectar e
**diz isso no log**, alto. Ele fica em laço de reinício até a etapa 5, e está tudo bem.

> Se o Render recusar o sync reclamando de `fromGroup`, é porque um dos seis grupos não
> existe ou está com outro nome. Volte à etapa 2.

> Se o Render recusar por causa de `SELF_HOST_TENANT_NAME` no serviço `realtime`, é a
> autorreferência em `fromService` — o único campo do arquivo que a documentação não
> fecha. A saída está na etapa 6.

---

## 4. O primeiro deploy: o que esperar, na ordem

O Render **não tem `depends_on`**: os sete serviços de um ambiente sobem em paralelo. A
ordem abaixo é a ordem em que eles ficam bons, não a ordem em que começam.

1. **`db`** é o único que constrói imagem do zero (Dockerfile). É o mais demorado.
2. **`kong`** também constrói, mas é rápido.
3. **`auth`, `rest`, `realtime`, `storage`, `meta`** baixam imagem pública e sobem em
   seguida — e **reiniciam em laço** até o banco existir e as URLs estarem certas.

**No log do `db`, procure, nesta ordem:**

- `99-jwt.sql`, `99-roles.sql` e `99-realtime.sql` aparecendo sem erro — são os três
  arquivos assados na imagem, e é aqui que o banco nasce completo;
- a linha do `roles.sql` dizendo que nenhum papel ficou de fora;
- `database system is ready to accept connections`.

**O risco conhecido do primeiro deploy do banco** é o disco chegar com um `lost+found`
dentro. Se acontecer, o log traz, literalmente:

```
initdb: error: directory "/var/lib/postgresql/data" exists but is not empty
```

A saída está comentada dentro do `render.yaml`: acrescentar ao serviço `db`

```
PGDATA = /var/lib/postgresql/data/pgdata
```

(o entrypoint da nossa imagem acompanha o `PGDATA` sozinho) e conferir se o
`postgresql.conf` da imagem não fixa `data_directory` no caminho antigo. **Isto não foi
verificado**: só a conta do Render diz se o disco nasce vazio.

Enquanto o banco não estiver de pé, é **normal** ver: `password authentication failed` ou
`could not translate host name` no `auth`, no `rest` e no `storage`; `_realtime` não existe
no `realtime`. O que **não** é normal é qualquer um deles subir e ficar quieto com o banco
fora do ar.

---

## 5. Preencher os endereços internos

Agora o banco existe e tem nome na rede privada.

1. No painel do serviço **`jardim-<amb>-db`**, abra **Connect → Internal** e copie o
   hostname (é `jardim-<amb>-db-XXXX`).
2. Faça o mesmo no **`jardim-<amb>-rest`**.
3. Preencha, no painel de cada serviço (Environment), trocando `preencher`:

```
auth    · GOTRUE_DB_DATABASE_URL = postgres://supabase_auth_admin:<SENHA>@<host-do-db>:5432/postgres
rest    · PGRST_DB_URI           = postgres://authenticator:<SENHA>@<host-do-db>:5432/postgres
storage · DATABASE_URL           = postgres://supabase_storage_admin:<SENHA>@<host-do-db>:5432/postgres
storage · POSTGREST_URL          = http://<host-do-rest>:3000
```

`<SENHA>` é a `POSTGRES_PASSWORD` daquele ambiente — a mesma que está no grupo
`jardim-<amb>-banco`. Ela aparece em claro dentro dessas três URLs, e não há como evitar:
os três serviços só aceitam a conexão como um texto único. Por isso ela é a **única** coisa
que você digita mais de uma vez; o alfabeto do gerador não tem símbolo, justamente para não
quebrar a leitura da URL.

4. Salve. O Render redeploya cada serviço alterado. Os três devem parar de reiniciar.

> **O `realtime` e o `meta` não aparecem nesta lista de propósito:** eles falam com o banco
> por campos separados (`DB_HOST`, `PG_META_DB_HOST`), e o `render.yaml` já resolve o
> hostname pela plataforma, com `fromService`. Não há nada a colar neles.

> **O `kong` também não:** os cinco nomes internos de que ele precisa (`AUTH_HOST`,
> `REST_HOST`, `STORAGE_HOST`, `META_HOST`, `REALTIME_HOST`) saem de `fromService`. Se
> alguém apagar um deles achando que é sobra, o Kong volta a apontar para `auth`, `rest` e
> `storage`, que são nomes que **só existem no compose**: ele sobe saudável e as chamadas
> morrem em DNS. Está escrito no `render.yaml`, no lugar.

---

## 6. O Realtime e o nome do tenant

O Realtime é multi-tenant e tira o id do tenant do **Host** da requisição. No compose o
contêiner se chama `realtime-dev.<projeto>`, e o tenant é `realtime-dev`. No Render o nome
interno é um rótulo só, sem ponto, e o `render.yaml` resolve isso mandando o Realtime criar
o tenant com exatamente esse nome (`SELF_HOST_TENANT_NAME`, lido do próprio serviço por
`fromService`). Os dois lados dessa conta foram lidos no código da versão `v2.130.0`, a
mesma fixada no compose.

**Se o Render recusar a autorreferência** (é o único campo que a documentação não fecha):

1. abra **Connect → Internal** do serviço `jardim-<amb>-realtime` e copie o hostname;
2. troque, no `render.yaml`, o bloco `fromService` de `SELF_HOST_TENANT_NAME` por
   `sync: false`;
3. cole o hostname no painel do serviço;
4. **confira** com o comando da etapa 8 antes de seguir.

> **Mudar esse valor depois, com o banco já de pé, cria um SEGUNDO tenant** em vez de
> renomear o primeiro. Não quebra nada, mas o velho fica lá. Acerte na primeira.

---

## 7. As migrações do banco

**Aqui há uma lacuna, e ela não é deste arquivo.** O `infra/scripts/publicar.sh`, que hoje
aplica as 8 migrações de `back/supabase/migrations` uma a uma e registra cada uma em
`jardim_publicacao.migracoes`, fala com o banco por `docker exec` — que **não existe no
Render**. O banco é Private Service e não tem porta pública.

Os dois caminhos possíveis, nenhum verificado:

- **Shell do Render** no serviço `db` (disponível conforme o plano da instância), rodando
  `psql` de dentro do contêiner. Problema: as migrações não estão na imagem do banco — o
  contexto de build dela é `infra/`, e elas moram em `back/supabase/`.
- **CLI do Render com SSH e encaminhamento de porta**, aplicando as migrações da máquina de
  quem publica, como o `publicar.sh` já faz, só trocando a forma de chegar ao `psql`.

O `seed.sql` **nunca** é aplicado, em ambiente nenhum: é massa de desenvolvimento.

Isto precisa virar trabalho próprio — um substituto do `publicar.sh` para o Render — e
depende de ver o que a conta oferece. Está na lista de pendências no fim deste arquivo.

---

## 8. Conferir que subiu certo

Com `ANON_KEY` e a URL pública do Kong daquele ambiente em mãos. Em `sh`:

```sh
API=https://jardim-staging-kong.onrender.com
ANON=<a ANON_KEY daquele ambiente>
```

**1. O Kong está de pé e a rota aberta responde** (é a mesma que o health check usa):

```sh
curl -si "$API/storage/v1/status" | head -1
# esperado: HTTP/2 200
```

**2. O controle de acesso está ligado** — sem `apikey`, a API recusa:

```sh
curl -si "$API/rest/v1/" | head -1
# esperado: HTTP/2 401
```

**3. O PostgREST responde, e o Kong achou o `rest`** (se este der erro de DNS ou 502, o
`REST_HOST` está errado):

```sh
curl -si -H "apikey: $ANON" "$API/rest/v1/" | head -1
# esperado: HTTP/2 200
```

**4. O GoTrue responde, e o Kong achou o `auth`:**

```sh
curl -si -H "apikey: $ANON" "$API/auth/v1/health" | head -1
# esperado: HTTP/2 200
```

**5. O Realtime respondeu PELO NOME CERTO DE TENANT.** Troque `<TENANT>` pelo hostname
interno do serviço `realtime` (Connect → Internal):

```sh
curl -si -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
     "$API/realtime/v1/api/tenants/<TENANT>/health" | head -1
# esperado: HTTP/2 200
# 404 aqui = o tenant tem outro nome: volte à etapa 6.
```

**6. A regra 2 do projeto continua valendo** — `anon` não escreve (depois das migrações):

```sh
curl -si -X POST -H "apikey: $ANON" -H "Content-Type: application/json" \
     -d '{"nome":"teste"}' "$API/rest/v1/tables" | head -1
# esperado: 401 ou 403. Um 201 aqui é defeito grave: pare e reporte.
```

**7. Os dois ambientes não se enxergam.** Do Shell de um serviço de staging, tentar
alcançar o banco de produção pelo hostname interno dele tem de falhar na resolução do nome.
É a separação por região; se um dia alguém trouxer os dois para a mesma região sem ligar o
bloqueio entre ambientes, este teste passa a dar certo — e é justamente aí que ele para de
ser o que queremos.

**8. Nenhum segredo no log.** Abra o log do `kong` e do `db` e confira que não aparece nem
a `service_role`, nem a senha do Postgres. As duas imagens foram escritas para isso (o
entrypoint do Kong imprime só o **nome** da variável que faltou), mas confira uma vez.

---

## 9. Depois da pilha: o front

O front é outro caminho inteiro, no `infra/render/NETLIFY.md`. Só o essencial daqui:

- `NEXT_PUBLIC_SUPABASE_URL` é a URL pública do Kong **daquele** ambiente;
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` é a `ANON_KEY` **daquele** ambiente;
- a `SERVICE_ROLE_KEY` **nunca** vai sob `NEXT_PUBLIC_` (regra 4 do `CLAUDE.md`), e há
  teste de grep do bundle publicado;
- trocar qualquer `NEXT_PUBLIC_` exige **construir o front de novo**: elas entram no bundle
  no build.

E, de volta ao Render: se o endereço do front mudar, mude junto `CORS_ORIGENS` no `kong` e
`GOTRUE_SITE_URL` / `GOTRUE_URI_ALLOW_LIST` no `auth`. Esquecer isso dá erro de CORS no
navegador com a pilha inteira saudável — nada aparece no log do servidor.

---

## Ordem curta, para conferir depois

1. `gerar-segredos.mjs`, duas vezes, guardado fora do git.
2. Seis grupos de variáveis no painel (`-banco`, `-jwt`, `-chaves`, vezes dois ambientes).
3. Blueprint, com o caminho `JardimMenu/infra/render/render.yaml`.
4. Primeiro deploy; ler o log do `db` até `ready to accept connections`.
5. Colar as quatro URLs internas (etapa 5).
6. Conferir o tenant do Realtime (etapa 6).
7. Aplicar as migrações (etapa 7 — ainda em aberto).
8. Rodar os oito testes da etapa 8.
9. Netlify.

---

## O que só a conta do Render decide

Nada abaixo foi verificado nesta máquina. Cada item pode mudar o que você faz.

1. **O plano do workspace e a separação entre ambientes.** No `render.yaml`, staging está em
   `ohio` e produção em `virginia`, e **é a região que separa os dois**: a rede privada do
   Render liga serviços do mesmo workspace **e da mesma região**. O Render tem um recurso
   melhor — bloquear tráfego privado entre ambientes — mas ele exige workspace Professional
   ou acima. Com esse plano, dá para trazer o staging para `virginia` **e** ligar o
   bloqueio. Uma coisa ou a outra: trazer o staging para perto sem ligar o bloqueio derruba
   a separação em silêncio, e NF-012 vai junto.
2. **Custo.** Catorze serviços e quatro discos. Os planos escritos (`1c-2g` no banco,
   `0.5c-512mb` nos outros) são um ponto de partida; o Render cobra por serviço, e o disco
   **cresce mas não encolhe**. Vale o PO olhar a conta antes do primeiro mês, e vale rever
   os planos com a medição do piloto.
3. **`rootDir` + `dockerfilePath`.** A documentação descreve os caminhos a partir da raiz do
   repositório, mas não diz o que acontece quando `rootDir` também está definido. Se o build
   falhar dizendo que não achou o Dockerfile, troque `dockerfilePath` por
   `render/db/Dockerfile` e `dockerContext` por `.`. Falha alta, sem risco de passar batido.
4. **Autorreferência em `fromService`** (o `SELF_HOST_TENANT_NAME` do Realtime). A saída
   manual está na etapa 6.
5. **O `lost+found` no disco do banco**, e com ele a necessidade ou não do `PGDATA` em
   subpasta. Etapa 4.
6. **Como aplicar as 8 migrações.** Etapa 7. O `publicar.sh` de hoje não serve no Render.
7. **O health check do Kong.** Ele aponta para `/storage/v1/status`, a única rota do
   `kong.yml` sem `key-auth` que devolve 200 num caminho fixo — o Render não manda cabeçalho,
   e toda rota protegida responderia 401 para sempre. O preço é que o Kong é marcado como
   não saudável quando o `storage` cai. Se isso incomodar na prática, a alternativa é tirar
   o `healthCheckPath` — sabendo que aí um Kong sem rota nenhuma passa a ser descoberto só
   quando o tablet parar.
8. **SMTP.** Sem ele o convite por e-mail não sai (JM-060). O caminho de criar acesso sem
   e-mail já existe no projeto e é o que destrava a primeira subida; o SMTP pode entrar
   depois, pelo painel, sem tocar no `render.yaml`.
