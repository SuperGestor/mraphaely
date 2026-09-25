# Operar o Jardim Menu no Render

Decisão de 24/09/2026: a pilha do Supabase vai para o **Render**, em contêineres, e o front
para o **Netlify**. Este arquivo é o procedimento de operação de lá: publicar, migrar,
restaurar e o que fazer quando cair.

O `infra/scripts/publicar.sh` continua sendo o procedimento do **servidor próprio com
compose** — ele não roda no Render (usa `docker compose` e `docker exec`) e não foi
alterado. A máquina de quem desenvolve e a esteira seguem no compose, sem mudança nenhuma.

> **Nada neste arquivo foi executado contra uma conta do Render.** O que foi executado de
> verdade está na seção [O que foi testado e o que não foi](#o-que-foi-testado-e-o-que-não-foi),
> no fim. Leia-a antes de confiar em qualquer número daqui.

---

## 1. O mapa dos serviços

Sete serviços da pilha viram sete serviços do Render, por ambiente. **Staging e produção
não compartilham nada** (NF-012): outro banco, outras chaves, outros serviços.

| serviço | tipo no Render | público? | disco |
| --- | --- | --- | --- |
| `db` | Private Service (imagem `infra/render/db`) | não | **sim**, em `/var/lib/postgresql/data` |
| `auth`, `rest`, `realtime`, `meta` | Private Service (imagens públicas) | não | não |
| `storage` | Private Service (imagem pública) | não | **sim**, em `/var/lib/storage` |
| `kong` | **Web Service** (imagem `infra/render/kong`) | **sim** | não |
| `manutencao` | **Cron Job** (imagem nossa, ver §2) | não | **não pode ter** |

O front fica no Netlify (`infra/render/NETLIFY.md`). O Kong é o **único** endereço público:
é ele que o tablet e o Netlify chamam.

Três regras da plataforma que explicam quase tudo daqui para baixo:

- **a rede privada liga serviços do mesmo workspace e da mesma região**, por nome interno.
  O nome interno **não é** só o nome do serviço: o Render o mostra como
  `<nome-do-servico>-<hash>`, no menu **Connect**, aba **Internal**. Copie de lá;
- **Cron Job não pode ter disco**, e **one-off job não enxerga o disco do serviço-base**.
  Nada que rode agendado consegue ler o disco do banco nem o do Storage;
- Cron Job **pode** abrir conexões para a rede privada (só não recebe conexões).

### As variáveis do Kong que ninguém pode esquecer

O `infra/kong/kong.yml` aponta para `${AUTH_HOST:-auth}`, `${REST_HOST:-rest}`,
`${STORAGE_HOST:-storage}`, `${META_HOST:-meta}` e `$REALTIME_HOST`. O padrão é o nome do
compose, que **não resolve no Render**. O serviço do Kong precisa receber os nomes internos
reais dos cinco. Se não receber, **o Kong sobe saudável e toda chamada à API morre em DNS**
— o health check passa, o painel fica verde e a loja não funciona.

---

## 2. O serviço de manutenção

`migrar.sh`, `backup.sh` e `restaurar.sh` precisam de três coisas que nenhuma imagem da
pilha tem juntas:

1. o cliente do Postgres **17** (`psql`, `pg_dump`, `pg_dumpall`, `pg_restore`) — cliente
   mais velho que o servidor 17.6 é **recusado na conexão**;
2. `rclone`, `curl`, `tar`, `gzip`, `flock`, `sha256sum`;
3. os arquivos do repositório: `back/supabase/migrations/` e `infra/`.

Por isso existe **um** serviço de manutenção, usado de três jeitos:

- como **Cron Job** agendado, ele é o backup diário;
- disparado à mão em **Runs → Trigger Run**, ele roda o que estiver no comando de início;
- como **serviço-base de um one-off job**, ele roda um comando avulso (migração,
  restauração) — o job herda a imagem e as variáveis de ambiente dele.

> **Pendência:** a documentação do Render diz que um one-off job usa "um dos seus serviços
> existentes" como base, mas não confirma que um **Cron Job** serve de base. Se não servir,
> o caminho é o **Trigger Run** do próprio Cron Job, trocando o comando de início — ou um
> segundo Cron Job com agenda que nunca dispara (`0 0 31 2 *`), usado só por Trigger Run.
> Isso se resolve em cinco minutos com a conta na mão.

Esse serviço **não tem disco** e não precisa: ele fala com o banco pela rede privada e com
o Storage pela API.

---

## 3. Publicar

Publicar no Render é **deploy de imagem**, e não o `publicar.sh`. A ordem importa:

1. **Front no Netlify** só depois da API, nunca antes (`infra/render/NETLIFY.md`).
2. **Banco primeiro**, e sozinho, na primeira subida: ele roda `initdb` e os três `.sql`
   assados. Espere ficar saudável antes de subir o resto.
3. `auth`, `rest`, `realtime`, `storage`, `meta`.
4. **Kong por último**, já com os cinco nomes internos preenchidos.
5. **Migrar** (§4). Em produção isso quer dizer: com a casa fechada.

O que este projeto tinha e o Render **não** dá de graça:

- **a checagem do bundle.** O `publicar.sh` rodava `grep` da service_role dentro de
  `.next/static` antes de publicar (regra 4). No Netlify isso tem de acontecer na esteira
  do front — está em `NETLIFY.md`;
- **a árvore do git limpa.** Em produção o `publicar.sh` recusava publicar com mudança não
  commitada, para a revisão no ar existir no histórico. No Render quem publica é o deploy a
  partir do repositório, então isso passa a ser disciplina de branch;
- **parar o app antes de migrar.** Não existe mais. Ver §4.

---

## 4. Migrar

```sh
bash infra/render/migrar.sh staging  --sim
bash infra/render/migrar.sh producao --sim
```

O banco é Private Service, **sem endereço público**: ninguém migra de fora. O
`migrar.sh` roda **dentro** da rede privada, a partir do serviço de manutenção.

**Como disparar:** one-off job com o serviço de manutenção como base (ou Trigger Run, ver a
pendência da §2), com o comando de início acima.

O que ele mantém do `publicar.sh`, porque é o que dá a garantia:

- o **mesmo registro** (`jardim_publicacao.migracoes`, com o `sha256` de cada arquivo) e a
  mesma escrita espelhada em `supabase_migrations.schema_migrations`. Um banco migrado
  antes pelo `publicar.sh` continua com **um** registro só;
- a **mesma trava do NF-012**: produção recusa migração que não rodou em staging, comparando
  versão **e** conteúdo. Não há opção que desligue isso;
- o backup antes de mexer no banco em produção (NF-011);
- a recusa de `seed.sql` e de arquivo fora do padrão na pasta de migrações.

O que muda:

- **a trava de simultaneidade é um advisory lock do Postgres**, e não `flock`. Cada disparo
  no Render é um contêiner novo com sistema de arquivos próprio: um `flock` ali não vê o
  outro disparo e protegeria nada. O Postgres solta o lock sozinho quando a conexão morre,
  então não existe trava presa para destravar na mão;
- **`--sim` é obrigatório em produção.** Cron Job e one-off job rodam sem terminal, e a
  pergunta de confirmação não tem como ser feita. Ao passar `--sim` você está afirmando o
  que a pergunta afirmaria;
- **O APP NÃO PARA.** Esta é a perda real da mudança de plataforma. No servidor próprio o
  `publicar.sh` parava o app enquanto o schema mudava; no Netlify não há equivalente. Um
  tablet pode enviar pedido no instante em que uma coluna deixa de existir, e quem vê o erro
  é o cliente, na mesa (JM-187). **Migração de produção se faz com a casa fechada.**

Para olhar sem tocar em nada:

```sh
bash infra/render/migrar.sh producao --listar
```

A trava do NF-012 exige que o disparo alcance **os dois** bancos. Se staging e produção
ficarem em regiões ou workspaces diferentes, a checagem não roda — e então a migração de
produção **para**, porque o NF-012 não é opcional.

---

## 5. Backup

O `infra/backup/backup.sh` serve no Render pelo caminho `MODO_BANCO=host`, que já existia, e
por um caminho novo para as fotos. A configuração está comentada no fim de
`infra/backup/exemplo/backup.env.exemplo`. Três pontos:

**O banco** sai por `pg_dump` pela rede privada. Exige `postgresql-client-17` na imagem —
o script confere a versão **antes** de qualquer coisa e para se o cliente for mais velho
que o servidor.

**As fotos** não saem por `tar`: o disco do Storage não é alcançável de um Cron Job.
`MODO_STORAGE=api` baixa foto por foto pela API do Storage, e **a lista de quais fotos
existem vem do banco** (`storage.objects`), não do endpoint de listagem — assim o número
esperado é conhecido antes de começar e conferido no fim. Uma foto que não baixa derruba a
rodada inteira: backup de fotos incompleto não é backup.

> O tar do modo `api` tem outro formato (entradas `<bucket>/<caminho>`, mais um marcador na
> raiz) e **só volta pelo `restaurar.sh` em modo `api`**. O `restaurar.sh` lê o marcador e
> **recusa** trocar um formato pelo outro, em vez de extrair fotos em caminho errado
> caladamente.

**O disco não existe.** Com `ARMAZENAMENTO_LOCAL_EFEMERO=sim`:

- `--sem-remoto` e `RCLONE_REMOTO` vazio passam a ser **recusados**. Sem isso, a rodada
  escreveria tudo num disco que some no fim do disparo e terminaria dizendo "backup em dia";
- a retenção local e o piso de `MINIMO_DUMPS_MANTIDOS` deixam de rodar: não há arquivo de
  ontem para proteger. O histórico inteiro passa a ser a **regra de ciclo de vida do
  bucket**. Configure-a: ela é agora a única coisa entre a casa e a perda do histórico;
- o resumo de "deu certo" passa a sair em **toda** rodada, porque não há onde guardar a
  marca do último. A mensagem diz isso, para ninguém achar que o backup enlouqueceu e
  silenciar o canal — que é como o próximo aviso de verdade deixa de chegar.

**Agenda:** Cron Job diário, fora do horário da loja. O teto de execução de um run é 12h.

---

## 6. Restaurar

```sh
bash infra/backup/restaurar.sh --de producao --para staging --do-remoto
```

O caminho normal continua sendo **restaurar produção dentro de staging**, e restaurar em
produção continua recusado por padrão (só com `--confirmo-producao` e duas respostas
digitadas — o que, sem terminal, quer dizer que **restauração em produção não se faz por
job agendado**: abra um shell onde dê para responder).

No Render:

- `MODO_BANCO=host` em `<AMBIENTE>_MODO_BANCO`, como no backup;
- `--do-remoto` é o caminho normal, não a exceção: **não há cópia local** de onde puxar;
- as fotos voltam pela API (`MODO_STORAGE=api`), uma a uma, com `x-upsert`. A restauração
  do banco vem antes, então as linhas de `storage.objects` já existem quando os arquivos
  sobem;
- depois de restaurar pela API **não é preciso reiniciar serviço nenhum**: as fotos
  entraram pelo próprio `storage-api`.

O NF-011 continua pedindo **uma restauração completa executada e registrada** em
`qa/restauracao-YYYY-MM-DD.md` antes da primeira subida a produção. No Render essa
restauração de teste é a **primeira coisa a fazer** com a conta na mão, porque é ela que
prova o caminho novo das fotos.

---

## 7. Monitoramento

`infra/monitoramento/verificar.sh` com `MODO_PLATAFORMA=render`. O que ele passa a olhar, e
o que deixou de olhar:

| item | no compose | no Render |
| --- | --- | --- |
| app (`/api/saude`) | sim | sim, no Netlify |
| API (`/auth/v1/health`) | sim | sim, pelo Kong |
| Storage (`/storage/v1/status`) | — | **sim** (novo) |
| contêineres (`docker ps`) | sim | **não existe** |
| banco (`select 1`) | pelo contêiner | só de dentro da rede privada |
| disco | sim | **não**: o disco que importa é do Render |

Três coisas foram feitas para isso não virar cobertura de mentira:

1. `<AMB>_CONTAINERS` preenchido **sem docker por perto** agora é **erro em voz alta**. Até
   24/09/2026 esse bloco sumia calado quando não havia docker — no servidor isso nunca
   acontecia, mas no Render aconteceria sempre: a configuração continuaria listando sete
   contêineres e nenhum seria olhado;
2. o **batimento diário passa a dizer, por escrito, o que não está sendo vigiado** —
   contêineres, disco do banco, e o banco quando o monitor está fora da rede privada;
3. o **Storage ganhou verificação própria**, porque ele cai sozinho: Kong de pé e Storage
   fora fazem o cardápio abrir **sem foto nenhuma**, o que o cliente vê na mesa e o check da
   API não pega.

**O que passa a ser do Render, e precisa ser ligado no painel dele:** alerta de disco do
banco e do Storage, alerta de serviço caído, e a política de reinício. Nada disso é feito
por script nosso.

> **Decisão pendente do PO:** no plano gratuito o Web Service hiberna, e o primeiro acesso
> depois da hibernação demora mais que `TIMEOUT_SEGUNDOS=8`. Isso vira "CAIU" todo dia de
> madrugada. Ou o Kong fica num plano pago, ou `TIMEOUT_SEGUNDOS` e `FALHAS_PARA_ALERTAR`
> sobem bastante — e aí uma queda de verdade demora mais para ser avisada.

---

## 8. Quando cair

Comece sempre pelo **painel do Render**: ele sabe de serviço caído, deploy falhado e disco
cheio antes de qualquer script nosso.

**A loja não abre.** É o Netlify ou é a API? Abra `<URL_API>/auth/v1/health` com a chave
anon. Responde: o problema é o front (Netlify). Não responde: siga abaixo.

**A API não responde (`000` ou `502`/`503`).** O Kong é o único público, então ele é o
primeiro suspeito — mas atenção ao caso que não parece queda: **Kong saudável e toda chamada
morrendo**. Isso é `AUTH_HOST`/`REST_HOST`/`STORAGE_HOST`/`META_HOST`/`REALTIME_HOST` com o
nome errado, ou serviço em outra região. O health check do Kong passa mesmo assim. Confira
os nomes internos em **Connect → Internal** de cada serviço.

**O cardápio abre sem foto.** É o Storage, e só ele. `/storage/v1/status` pelo Kong.

**O banco não responde.** Ele é Private Service: não dá para alcançá-lo de fora nem para
"entrar nele". Veja os logs do serviço no painel. Se o **primeiro** deploy falhou com
`initdb` reclamando de diretório não vazio, é o `lost+found` do disco — a saída é apontar
`PGDATA` para uma subpasta do disco (o entrypoint acompanha).

**Uma migração parou no meio.** O `migrar.sh` diz quantas entraram, e elas estão aplicadas e
registradas. Cada migração roda na própria transação, então a que falhou ou entrou inteira
ou não entrou nada. Veja onde parou, sem tocar em nada:
`bash infra/render/migrar.sh <ambiente> --listar`. **O app continuou no ar o tempo todo,
sobre um banco no meio do caminho: confira a loja antes de qualquer outra coisa.**

**O backup falhou.** O aviso do Telegram traz o fim do registro da rodada. Os dois motivos
mais prováveis no Render: o nome interno do banco mudou (ele muda se o serviço for recriado)
ou a service_role foi rotacionada e o `MODO_STORAGE=api` parou de baixar as fotos.

**"Backup em dia" mas nada no bucket.** Não deveria mais acontecer: com
`ARMAZENAMENTO_LOCAL_EFEMERO=sim` o script recusa rodar sem destino externo. Se acontecer,
é que essa variável não está valendo — confira que a configuração está chegando ao Cron Job.

---

## O que foi testado e o que não foi

Escrito em 25/09/2026, na máquina de desenvolvimento, **sem conta do Render**.

### Executado de verdade

| o que | como | resultado |
| --- | --- | --- |
| `migrar.sh`: lista, aplica, registra | `psql` de mentira, migrações de teste | aplica na ordem, grava versão + sha256, advisory lock no lote |
| `migrar.sh`: trava do NF-012 | produção sem staging, e com arquivo editado depois | recusa nos dois casos, dizendo qual arquivo e os dois sha256 |
| `migrar.sh`: produção sem terminal | `stdin` fechado | para e manda usar `--sim`, explicando que o app não para |
| `migrar.sh`: migração com aspas no nome | arquivo `..._it's.sql` | recusa **antes** de rodar qualquer coisa |
| `migrar.sh`: psql falha no meio | saída 3 depois da 1ª migração | relata `migracoes_aplicadas=1 de=2`, lido do banco |
| `migrar.sh`: psql sai 0 sem registrar | lote que não grava nada | **falha** com `conta-nao-fecha`, em vez de dizer "ok" com 0 aplicadas |
| `backup.sh`: `MODO_BANCO=host` + `MODO_STORAGE=api` | `curl`/`psql`/`pg_*` de mentira | 3 fotos baixadas, tar com marcador, dump e papéis gerados e enviados |
| `backup.sh`: service_role em linha de comando | inspeção de tudo que chegou ao `curl` | **não aparece**: vai em arquivo `-K`, com 600 |
| `backup.sh`: `--sem-remoto` com disco efêmero | `ARMAZENAMENTO_LOCAL_EFEMERO=sim` | recusado, saída 2 |
| `restaurar.sh`: fotos pela API | tar do backup acima, "servidor" esvaziado | as 3 fotos voltam, conteúdo idêntico |
| `restaurar.sh`: detecção de formato | tar do modo `api` e tar antigo | distingue os dois pelo marcador |
| `restaurar.sh`: detecção num tar grande | 12.004 entradas | detecta `api`. **Não** foi reproduzida falha na versão com cano — o marcador fica no fim da listagem. A versão sem cano foi mantida por não depender dessa ordem |
| **regressão do compose** | `DIR_STORAGE` sem `MODO_STORAGE` | tar no formato antigo, sem marcador; retenção local roda; `jm_modo_storage` reproduz a escolha antiga em todos os casos |
| monitoramento: `CONTAINERS` sem docker | `PATH` sem docker | **erro em voz alta** (antes sumia calado) |
| monitoramento: modo render | Storage fora (503) | acusa o Storage; batimento lista o que não é vigiado |
| sintaxe | `bash -n` em todos os scripts alterados | limpo |

### Não executado — só uma conta do Render prova

- **tudo que é do Render**: nome interno de Private Service, Cron Job alcançando a rede
  privada, one-off job usando Cron Job como base, Trigger Run, teto de 12h;
- **o `pg_dump` por TCP contra o Postgres 17.6 de verdade**, incluindo se o `supabase_admin`
  enxerga `auth` e `storage` por esse caminho como enxerga por socket;
- **os endpoints do storage-api**: `GET`/`POST /storage/v1/object/<bucket>/<caminho>` e o
  cabeçalho `x-upsert`. Foram escritos a partir do `kong.yml` (que roteia `/storage/v1/` sem
  `key-auth`) e do uso que `back/controllers/fotos.ts` faz do bucket `produtos`, mas **não
  foram exercitados contra um `storage-api` de verdade** — só contra um `curl` de mentira.
  É a maior incerteza deste trabalho, e é o que a restauração de teste do NF-011 resolve;
- **se `storage.objects` lista exatamente os arquivos que existem em disco.** Se o Storage
  tiver arquivo órfão (em disco e não na tabela), ele **não** entra no backup — e essa é uma
  troca deliberada: preferimos a lista que o banco garante à varredura que o endpoint de
  listagem daria;
- **o comportamento de hibernação** do Web Service no plano gratuito.
