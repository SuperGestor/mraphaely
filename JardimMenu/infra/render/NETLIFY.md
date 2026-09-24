# O front no Netlify

Decisão do PO em 24/09/2026, que substitui o servidor próprio de 22/09: a pilha do Supabase
vai para o **Render**, em contêineres, e o front vai para o **Netlify**. As duas contas são
do Super Gestor.

Este documento cobre só o front. O `infra/docker-compose.yml` continua existindo e não é
tocado: ele é o que roda na máquina de quem desenvolve e o que a esteira usa.

O arquivo de configuração é `front/netlify.toml`, versionado, com o porquê de cada linha.
Aqui está o que **não cabe em arquivo**: o que é feito à mão no painel, e por quê.

---

## 1. Criar o projeto

O repositório é o `SuperGestor`, e o front é uma pasta dentro dele. O Netlify clona o
repositório inteiro, mas **só procura o `netlify.toml` na "base directory"**, e não adivinha
qual é. Então, ao criar o projeto:

| Campo | Valor |
|---|---|
| Base directory | `JardimMenu/front` |
| Build command | deixe como vier — o `netlify.toml` sobrescreve |
| Publish directory | deixe como vier — o `netlify.toml` sobrescreve |

Depois do primeiro deploy, confira no log que o Netlify diz ter lido o
`JardimMenu/front/netlify.toml`. Se ele não achar o arquivo, o build usa os campos do painel
e **nada** deste documento vale — nem a varredura de segredos, nem a versão do Node.

O `back/` (D33) fica em `JardimMenu/back`, irmão do `front/`. Ele chega ao build porque o
clone é do repositório inteiro, e é compilado para dentro dos chunks de servidor do Next
pelo `experimental.externalDir`. Não é preciso configurar cópia de arquivo nenhuma.

---

## 2. Variáveis: as de BUILD e as de EXECUÇÃO

Esta é a parte que erra fácil e que a regra 4 do CLAUDE.md governa.

### Como o Netlify separa as duas

Pelo **escopo** da variável. Cada variável cadastrada no painel recebe um ou mais escopos:

- **Builds** — existe enquanto o `next build` roda;
- **Functions** — existe dentro da função, em execução, a cada requisição;
- **Runtime** e **Post processing** — os outros dois, que não usamos aqui.

E a restrição que decide tudo: **variável declarada em `netlify.toml` não tem escolha de
escopo.** Ela nasce com "Builds" e "Post processing". É por isso que a
`SUPABASE_SERVICE_ROLE_KEY` **não pode** estar no `netlify.toml`: não existe maneira de
declará-la lá sem entregá-la ao build.

### As que vão no BUILD

São as `NEXT_PUBLIC_`. O Next as troca pelo valor **durante o build**, dentro do JavaScript
que vai para o tablet. Não são segredo: a chave `anon` trabalha sob RLS (NF-005), e o que
protege o dado é a policy do banco, não o sigilo da chave.

| Variável | Escopo no painel | O que é |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Builds **e** Functions | URL pública do Kong daquele ambiente, no Render |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Builds **e** Functions | Chave anon, sob RLS |
| `NEXT_PUBLIC_DATA_SOURCE` | Builds | `supabase` liga a fonte real; vazia deixa os dados de exemplo |
| `NEXT_PUBLIC_APP_ORIGIN` | Builds **e** Functions | Origem pública do ambiente |

Duas delas pedem "Builds **e** Functions" porque também são lidas em código de servidor
(`middleware.ts` e `back/services/invite-user.ts`). O Next costuma assar o valor também no
código de servidor, mas marcar os dois escopos custa nada e tira a dúvida; elas são
públicas, então não há o que proteger.

> **Consequência que não muda de plataforma:** trocar uma `NEXT_PUBLIC_` exige **construir
> de novo**. Reiniciar não adianta, porque o valor já está dentro do JavaScript publicado. É
> a mesma frase que está no `front/Dockerfile`, e é o motivo de cada ambiente ter o seu
> build.

> **Cuidado com o `NEXT_PUBLIC_APP_ORIGIN`:** é a origem que vai no QR de pareamento, e o
> `device_token` do tablet mora no armazenamento local, que é **por origem**. Trocar a
> origem depois de provisionar os tablets invalida o pareamento de todos eles. O CLAUDE.md
> já registra que ainda não há domínio: enquanto o endereço for o `*.netlify.app`, o tablet
> de produção não deve ser pareado.

### As que vão na EXECUÇÃO

Segredos de servidor. Cadastre no painel do Netlify (ou por `netlify env:set`), com escopo
**Functions apenas** — sem "Builds".

| Variável | Escopo no painel | Onde é lida |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **Functions** | `back/services/invite-user.ts`, e só ali |
| `ALERT_TELEGRAM_BOT_TOKEN` | **Functions** | alerta do NF-009 |
| `ALERT_TELEGRAM_CHAT_ID` | **Functions** | alerta do NF-009 |
| `ALERT_WEBHOOK_URL` | **Functions** | canal antigo do NF-009 |

Marque as quatro como **"Contains secret values"** (Secrets Controller). Isso esconde o valor
do painel depois de salvo e impede que deploy de fork as enxergue.

Tirar a `SUPABASE_SERVICE_ROLE_KEY` do escopo "Builds" não é burocracia: é a garantia
estrutural de que ela não pode vazar para o bundle. O `next build` não consegue assar um
valor que não existe no ambiente dele. Nenhum arquivo do projeto lê essa chave em tempo de
build — o `invite-user.ts` só a lê dentro da função, quando o convite é enviado.

### Contexto de deploy

O Netlify permite um valor por contexto (`production`, `deploy-preview`, `branch-deploy`).
Use isso: **deploy preview não pode nascer apontando para o Supabase de produção.** Se a
`NEXT_PUBLIC_SUPABASE_URL` for cadastrada como "mesmo valor em todos os contextos", toda
pré-visualização de pull request vira um app de produção com outro endereço. Cadastre o valor
por contexto, ou deixe o `NEXT_PUBLIC_DATA_SOURCE` vazio no contexto `deploy-preview`, o que
faz o preview abrir sobre os dados de exemplo.

**Esta é uma escolha de produto, e está em aberto para o PO.** O código suporta as duas.

---

## 3. Varredura de segredos

O Netlify procura, no que o build gerou, o **valor** de cada variável de ambiente do projeto,
e **reprova o build** quando acha algum. Como as `NEXT_PUBLIC_` existem justamente para estar
no bundle, sem configuração o build reprova sempre.

O `netlify.toml` já traz a lista mínima:

```toml
SECRETS_SCAN_OMIT_KEYS = "NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,NEXT_PUBLIC_APP_ORIGIN,NEXT_PUBLIC_DATA_SOURCE"
```

Três regras sobre isso:

1. **Só entram nessa lista variáveis `NEXT_PUBLIC_`.** Se um dia aparecer vontade de
   acrescentar `SUPABASE_SERVICE_ROLE_KEY` ali, a resposta é não: a varredura sobre ela é
   exatamente a rede de segurança que interessa. Build reprovado por causa dela é um acerto,
   e quer dizer que alguém colocou a chave onde não devia.
2. **Não desligue a varredura inteira** (`SECRETS_SCAN_ENABLED = "false"`) pelo mesmo motivo.
   Falha silenciosa é o pior defeito deste projeto; trocar um build vermelho por uma chave
   vazada em silêncio é o pior negócio possível.
3. Se a detecção inteligente reprovar por um valor que não é segredo (acontece com strings
   curtas e com coisas em formato de JWT), a saída certa é
   `SECRETS_SCAN_SMART_DETECTION_OMIT_VALUES` com aquele valor, e não desligar nada.

O projeto já tem, por fora disso, o teste de grep do bundle publicado (§9.4 dos requisitos).
Os dois convivem: o teste é nosso e roda na esteira; a varredura é do Netlify e roda no build
deles.

---

## 4. Middleware, cookies de sessão e cache

No Netlify o `middleware.ts` vira uma **Edge Function**, na frente de uma CDN. O
`@supabase/ssr` reescreve os cookies de sessão a cada requisição, então toda resposta de
`/admin`, `/equipe`, `/login`, `/api/admin/*` e `/api/equipe/*` pode sair com `Set-Cookie`.
Resposta com cookie de sessão que caia em cache compartilhado é **sessão de uma pessoa
entregue a outra**.

O que já está feito, e onde:

- **`front/next.config.ts`** passou a devolver `Cache-Control: private, no-store, max-age=0,
  must-revalidate` nesses caminhos. Ele tem de morar ali, e não no `netlify.toml`: os
  `[[headers]]` do `netlify.toml` valem só para arquivo servido do armazenamento do Netlify,
  e **não** para resposta de função, de edge function ou de SSR. Cabeçalho posto no
  `next.config.ts` entra no `routes-manifest.json` do build e vale para os dois casos.
- **Isto não é só precaução.** O `npm run build` deste projeto marca `/admin`,
  `/admin/*` e `/equipe` como **estáticas** (`○`, pré-renderizadas). Página estática é
  justamente o que a CDN do Netlify guarda por padrão. O HTML delas não carrega dado de
  usuário — os dados vêm depois, por `/api/admin/dados` e `/api/equipe/salao` —, então o
  que estaria em cache é a casca, não a sessão. Ainda assim, tela autenticada guardada em
  CDN é exatamente o tipo de coisa que ninguém quer descobrir depois.
- Resposta **dinâmica** de função (as `/api/*`, e o `/login`) o Netlify **não** guarda por
  padrão: ela só entra no cache quando alguém opta por isso com `Netlify-CDN-Cache-Control`.
  Ali o cabeçalho existe para que continue assim depois de qualquer mudança de cache.

O que **falta**, e não está no meu grupo de arquivos:

> **`front/middleware.ts` precisa de uma linha.** Desde a versão 0.10.0, o `@supabase/ssr`
> passa ao callback `setAll` um **segundo argumento** com os cabeçalhos de cache
> (`Cache-Control`, `Expires`, `Pragma`) que aquela resposta precisa carregar. O projeto usa
> `^0.12.7`, e o `setAll` de hoje recebe só o primeiro argumento e descarta o resto. A
> correção é aceitar o segundo parâmetro e aplicá-lo na resposta, junto dos cookies. É essa
> a tranca primária; o `next.config.ts` é a segunda.

**Como conferir depois de publicar** (não dá para conferir antes):

```sh
curl -sI https://SEU-SITE.netlify.app/login | grep -i -E 'cache-control|set-cookie|netlify'
```

Espere `cache-control: private, no-store, ...`. Se vier `public` ou um `max-age` alto, pare e
não pareie tablet nenhum.

---

## 5. O teto de créditos, com a conta

O plano gratuito do Netlify é **por crédito, com teto rígido**: **300 créditos por mês**, sem
poder comprar mais, e **quando os créditos acabam todos os projetos da conta são pausados** —
quem abrir o endereço vê uma página de "Site not available". Não há degradação: há
desligamento. Num salão em serviço, isso é o tablet parar de pedir no meio do jantar.

### As tarifas (consultadas em 24/09/2026)

| Item | Custo |
|---|---|
| Requisições web (inclui asset estático, chamada de função e edge function) | 2 créditos por 10.000 |
| Computação de função | 10 créditos por GB-hora (memória padrão: 1 GB) |
| Banda | 20 créditos por GB |
| Deploy de produção | 15 créditos cada |
| Deploy preview e branch deploy | 0 |

| Plano | Créditos/mês | Preço |
|---|---|---|
| Free | 300 (teto rígido, sem recarga) | US$ 0 |
| Personal | 1.000 | US$ 9 |
| Pro | a partir de 3.000 | a partir de US$ 20 |

### O que um tablet gasta, com o polling de 10 s que já está no código

O tablet faz duas chamadas periódicas, as duas para rotas nossas, na mesma origem — ou seja,
**cada uma é uma requisição web e uma invocação de função no Netlify**:

- `/api/tablet/resumo`, a cada **10 s** (`front/components/tablet/useMesa.ts`, `POLLING_MS`).
  São 6 por minuto, 360 por hora. Isto é requisito (P7, §8.6), não um plano B.
- `/api/tablet/heartbeat`, a cada **60 s** (`useSaudeDoTablet.ts`, JM-184). São 60 por hora.

Total: **420 requisições por hora, por tablet ligado.**

A fórmula, para refazer a conta com outras premissas (`H` = horas por dia com o tablet
ligado, `D` = dias no mês, `d` = duração média da função em segundos):

```
requisições/mês = 420 × H × D
créditos de requisição = requisições ÷ 10.000 × 2
créditos de computação  = requisições × d ÷ 3600 × 10        (memória de 1 GB)
```

Com **H = 12 h/dia** e **D = 30**, dá **151.200 requisições por mês, por tablet**:

| Parcela | d = 0,15 s | d = 0,25 s | d = 0,40 s |
|---|---|---|---|
| Requisições web | 30 | 30 | 30 |
| Computação | 63 | 105 | 168 |
| Banda (~0,3 GB de JSON) | 6 | 6 | 6 |
| **Por tablet, por mês** | **~99** | **~141** | **~204** |

O `d` é o que não dá para saber sem medir: cada chamada dessas vai ao Postgres no Render, e
**não há região do Render na América do Sul** — a decisão do PO já contempla isso. Quanto
maior a viagem, maior o `d`, e o `d` é a maior parcela da conta. Meça no primeiro dia de
piloto e volte aqui.

A tela da equipe soma por cima: uma tela aberta o turno inteiro relê `/api/equipe/salao` a
cada 15 s com Realtime e a cada 10 s sem ele, o que dá **mais ~77 créditos/mês** no caso
central.

### O que isso quer dizer

Com o caso central (`d = 0,25 s`), **um** tablet, **uma** tela da equipe e **dez** deploys de
produção no mês:

```
141 (tablet) + 77 (equipe) + 150 (10 deploys × 15) = 368 créditos
```

**368 > 300.** O plano gratuito **não** aguenta o piloto de um aparelho só (que é como a Fase
D começa, por decisão de 21/09), somado a um ritmo normal de publicação. E não aguenta com
folga nenhuma: não entra nessa conta a navegação do cliente, as telas do admin, nem o staging.

Projeção para o salão cheio (11 tablets, que é o número do CLAUDE.md):

```
11 × 141 + 77 + 150 ≈ 1.778 créditos/mês
```

**Decisão para o PO, com o número à vista:**

1. **Free (300)** — só serve para experimentar. Pausa no meio do serviço é questão de
   quando, não de se.
2. **Personal (US$ 9, 1.000)** — cobre o piloto de um aparelho e o começo, com margem. É o
   piso realista.
3. **Pro (a partir de US$ 20, 3.000)** — é o que o salão cheio pede.

Três observações que mudam a conta, e que são decisão de produto, não minha:

- **Os créditos são da conta, não do projeto.** Staging e produção dividem o mesmo bolo.
  Deploys de **branch** e **preview** custam 0; só o deploy de produção custa 15. Se staging
  for um branch deploy do mesmo projeto em vez de um projeto separado, os deploys de staging
  passam a custar zero. Em troca, os dois ambientes ficam na mesma conta de projeto — e o
  NF-012 pede separação. **Pergunta aberta ao PO.**
- **O polling do tablet não precisa, tecnicamente, passar pelo Netlify.** Ele hoje chama
  rotas nossas na mesma origem, que por sua vez chamam o banco. Se um dia o tablet falasse
  direto com o Kong no Render, a maior parcela desta conta sumiria. Isso mexe em regra 1
  (verificação do `device_token`) e em `lib/tablet-source.ts`: **não foi feito, e não deve
  ser feito sem decisão explícita.**
- **Os 10 s são requisito** (P7). Não os mude para caber no plano; se o custo incomodar, o
  que se troca é o plano ou o caminho da requisição, não o requisito.

### Antes de pousar o primeiro tablet

Ligue os avisos de uso (50%, 75%, 90%, 100%) para um endereço que alguém lê **todo dia**. O
aviso de 90% é a última chance de agir antes de o salão parar.

---

## 6. Dois ambientes (NF-012)

Staging e produção são separados e cada um tem o seu build, porque as `NEXT_PUBLIC_` são
assadas: a imagem de staging aponta para o Kong de staging **para sempre**.

As duas formas possíveis:

| | Dois projetos no Netlify | Um projeto, staging como branch deploy |
|---|---|---|
| Separação (NF-012) | completa | mesma conta de projeto |
| Custo de deploy de staging | 15 créditos | 0 |
| Endereço | dois independentes | `staging--nome.netlify.app` |
| Variável por ambiente | por projeto | por contexto de deploy |

Nada foi escolhido aqui: o `netlify.toml` funciona nas duas. **Pergunta aberta ao PO.**

Vale a regra que já está no `docs/operacao/PUBLICACAO.md` e não muda de plataforma: variável
muda **no staging primeiro**, exatamente como código.

---

## 7. O que não deu para verificar sem uma conta do Netlify

Foi verificado nesta máquina, rodando:

- `tsc --noEmit` limpo depois da mudança no `next.config.ts` (NF-010);
- `npm run build` do front terminou com código 0 com o `next.config.ts` alterado, e
  `output: "standalone"` continua valendo;
- os sete cabeçalhos da §4 aparecem no `.next/routes-manifest.json` gerado pelo build, com
  os caminhos e as expressões regulares certas. Isto prova que o **Next** os emite; não
  prova que o **Netlify** os entrega.

**Não** foi verificado, e só se prova com uma conta do Netlify na mão:

1. Que o Netlify encontra o `JardimMenu/front/netlify.toml` com a base apontada no painel.
2. Que o `publish = ".next"` resolve para `JardimMenu/front/.next` — é o erro clássico de
   monorepo, e só o log do build mostra.
3. Que o adaptador do Next é instalado sozinho e aceita o `output: "standalone"` **neste**
   projeto. A leitura do código do adaptador diz que "standalone" e o valor não declarado
   caem no mesmo ramo da verificação; leitura de código não é execução.
4. Que `JM_COMMIT=$COMMIT_REF` chega ao `next.config.ts` e aparece na versão do heartbeat.
5. Que a varredura de segredos passa com a lista do `SECRETS_SCAN_OMIT_KEYS` — e, mais
   importante, **que ela ainda reprova** se a `service_role` for cadastrada com escopo
   "Builds" por engano. Vale fazer esse teste de propósito, uma vez, em staging.
6. Que o `Cache-Control: private, no-store` sai mesmo na resposta de `/admin` e
   `/api/admin/*` servidas por função (o `curl -sI` da §4).
7. Que o middleware como Edge Function mantém a sessão da equipe entre requisições. Este é o
   ponto de maior risco, e depende da correção pendente no `front/middleware.ts`.
8. Que o `sharp` (upload de foto) funciona dentro da função do Netlify. Ele traz binário por
   plataforma; o build do Netlify é Linux x64, como a imagem Docker, mas empacotamento de
   função não é imagem de contêiner.
9. **O valor real de `d`** — a duração média da função. Toda a conta de créditos da §5 se
   move com ele, e ele só existe depois do primeiro dia de tráfego real contra o Render.
