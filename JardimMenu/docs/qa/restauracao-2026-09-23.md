# Restauração completa — 2026-09-23

**Primeira execução real da infraestrutura.** Até esta data nada de `infra/`
tinha rodado: tudo foi escrito sem Docker disponível. Esta rodada subiu a pilha,
publicou, fez backup e restaurou, e achou quatro defeitos de primeira execução —
três deles impediriam a produção de funcionar, e um deixaria a casa sem
restauração de verdade sem ninguém perceber.

> **O que esta rodada NÃO é:** o ensaio no servidor do dono do produto. Rodou na
> máquina de desenvolvimento, em Docker, sem Caddy, sem HTTPS e sem a cópia
> externa do backup. O NF-011 pede a restauração testada **antes da primeira
> subida a produção**, e este registro é o primeiro passo dela, não o último: o
> ensaio se repete no servidor, com HTTPS e com o destino externo ligado.

## 1. O ambiente

| Campo | Valor |
|---|---|
| Onde | máquina de desenvolvimento, Docker Desktop 29.8.0 |
| Pilha | `infra/docker-compose.yml`, projeto `jardim-staging` |
| Postgres | `public.ecr.aws/supabase/postgres:17.6.1.167` |
| Publicação | `infra/scripts/publicar.sh staging`, 8 migrações aplicadas e registradas |
| Massa | `back/supabase/seed.sql`: 2 lojas, 6 produtos, 11 mesas, 4 contas |
| Proxy e HTTPS | **não** — sem Caddy nesta rodada, e é a maior lacuna dela |
| Cópia externa (rclone) | **não configurada** — segue pendente de decisão do PO |

## 2. O que foi restaurado

| Campo | Valor |
|---|---|
| Arquivo | `jardim-staging-2026-09-23T2013.dump` (540 KB, formato custom) |
| Origem → alvo | staging → staging |
| Estrago proposital antes | apagados a conta `garcom@jardim.local`, o vínculo dela e o produto "Burger do jardim" |
| Estado antes | `auth.users` 3, `products` 5 |
| Linhas de erro no `pg_restore` | **0** |
| Resultado | RESTAURAÇÃO CONFERIDA: todas as tabelas bateram com o backup |

| Tabela | No backup | Restaurado | Situação |
|---|---:|---:|---|
| `auth.users` | 4 | 4 | ok |
| `storage.objects` | 0 | 0 | ok |
| `products` | 6 | 6 | ok |
| `stores` | 2 | 2 | ok |
| `store_users` | 4 | 4 | ok |
| `tables` | 11 | 11 | ok |
| demais tabelas conferidas | — | — | todas ok |

A conta apagada voltou (`garcom@jardim.local`) e o produto apagado voltou. É esse
o ponto do exercício: restaurar sem estrago prévio não prova nada.

## 3. Os quatro defeitos que esta rodada achou

### 3.1 Um papel inexistente derrubava a criação inteira do banco (bloqueava)

Seis serviços subiram, quatro mancando: Storage e Realtime em laço de reinício,
PostgREST recusando o cache de schema, GoTrue parado em "must be owner of
function uid". Uma linha explicava os quatro: o `ALTER USER
supabase_functions_admin` do `postgres/roles.sql` falhava (esse papel não existe
mais na imagem 17.6.1.167), e o `migrate.sh` da imagem, que roda com `set -eu` e
`ON_ERROR_STOP=1`, morria ali — levando junto a senha do `supabase_storage_admin`,
a do `supabase_admin` e a pasta `migrations/` inteira da imagem.

Corrigido: a senha passa a ser dada por consulta a `pg_roles` com `\gexec`.
Papel que não existe é ignorado, e nenhuma mudança de papel numa versão futura
da imagem derruba a criação do banco.

### 3.2 O backup saía sem as contas da equipe (bloqueava, e em silêncio)

`pg_dump` rodando como `postgres` **não enxerga** os schemas `auth` e `storage`,
que pertencem a `supabase_admin`. Ele não falha, não avisa e devolve código 0 —
só entrega um dump sem eles. O dump tinha **zero** entradas de `auth` e
`storage`.

Consequência num desastre real: o cardápio voltaria e **ninguém da equipe
conseguiria entrar**, porque `public.store_users` voltava apontando para contas
que não existiam mais.

Corrigido: o papel padrão passa a ser `supabase_admin` no backup e na
restauração, e o modelo de configuração diz por quê.

### 3.3 A restauração declarava "CONFERIDA" sem as contas (grave)

O manifesto só contava tabelas do `public`. Com as contas faltando, todas as
contagens batiam e o veredito saía verde, com 530 linhas de erro no
`pg_restore` ignoradas.

Corrigido: `auth.users` e `storage.objects` entram nas tabelas conferidas, com o
schema no nome. Agora a restauração compara as duas e não tem como dar verde sem
elas. Depois da correção: 0 erros no `pg_restore`.

### 3.4 A trava nova acusava ausência justamente quando encontrava (meu)

A verificação escrita para 3.2 usava `printf ... | grep -q`. O `grep -q` sai no
primeiro acerto, o `printf` morre de SIGPIPE e, com `set -o pipefail`, o
pipeline vira falha: encontrar a tabela era registrado como não encontrar.
Trocado por casamento em bash puro, sem cano.

## 4. O que fica pendente para o ensaio no servidor

- [ ] HTTPS de verdade pelo Caddy, com certificado emitido (aqui não houve proxy).
- [ ] Cópia externa do backup ligada (`rclone`), que é o que o NF-011 exige de fato.
- [ ] Alerta no Telegram configurado: nesta rodada o script disse "não configurado" e só registrou em log — comportamento correto, mas não provado de ponta a ponta.
- [ ] Timers do systemd rodando o backup e o monitoramento sozinhos.
- [ ] Restauração de **produção dentro do staging**, que é o caminho normal do script; aqui foi staging → staging, porque só existe um ambiente nesta máquina.
