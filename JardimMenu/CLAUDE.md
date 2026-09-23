# Jardim Menu, regras do projeto

Este arquivo é lido automaticamente pelo Claude Code em toda sessão aberta nesta
pasta. Ele existe para que as regras abaixo não dependam de serem coladas.

**Quando o repositório da aplicação for criado, copie este arquivo para a raiz dele.**

## Documento de verdade

`docs/REQUISITOS-v1.8.md` é a fonte de escopo. Onde ele e qualquer outra coisa
divergirem, vale ele, e a divergência é reportada, não contornada. **O schema da primeira
versão está em `docs/PLANO-SCHEMA.md`**, e é ele que a migração segue.

A v1.8 incorporou as decisões de 10 e 11/09/2026 (D23 a D33) e corrigiu os resíduos que a
auditoria de 10/09 encontrou. **Onze pontos de produto seguem provisórios, na §14.1:**
trate como decidido, mas avise se algo depender deles.

O documento passou por duas auditorias independentes, e as duas encontraram defeito
bloqueante em versões declaradas prontas. Na v1.8, a §8 foi auditada contra Postgres de
verdade; o resto **não**. Presuma que há defeito: se um requisito parecer errado,
impossível ou ambíguo, diga. Não invente a interpretação conveniente.

## Canais: o tablet agora, o celular na Fase C

**Canal principal, e o único das Fases A e B:** tablet do estabelecimento, fixo por
mesa, em modo kiosk, com **autoatendimento**. O cliente monta e envia o pedido sozinho,
e a equipe não entra no fluxo.

**Canal secundário, Fase C, Módulo O (§5.13):** a plaquinha com QR abre o cardápio em
**modo leitura** no celular do cliente, e para pedir **o garçom abre uma comanda com
nome e telefone**. Não construa nada disso antes da Fase C, mas **não apague o
`tables.qr_token`**: ele é dessa plaquinha.

Sete consequências que governam todo o código:

1. **A prova de presença física é o `device_token`** do tablet, provisionado pela casa
   e vinculado a uma mesa. No canal celular, quem autoriza é um garçom, nunca um
   segredo impresso. Cartão da mesa, `printed_code`, NFC e anti-abuso de validação
   estão arquivados no §17 com prioridade W: não construa nada deles.
2. **O botão de chamar o garçom é a única saída humana** (JM-187). Ele precisa
   funcionar quando o pedido não funciona: sem rede, com a mesa em contingência, com a
   sessão fechada. Nunca o coloque atrás do mesmo caminho que pode quebrar.
3. **O tablet é compartilhado.** A limpeza de sessão entre clientes (JM-183) é
   requisito, não polimento; ela renova a sessão do pixel e zera a comanda ativa.
4. **A mesa tem comandas** (Módulo N, §5.12). Todo pedido pertence a uma comanda. A
   sessão não tem estado `closing`, e vai a `closed` sozinha quando a última comanda é
   encerrada ou migrada.
5. **A cozinha fica no PDV da casa** (D24). Na primeira versão, o pedido aparece na tela
   da equipe (JM-121), que o lança no PDV. Não existe fila de cozinha nossa, não existe
   status de pedido e não existe impressão nossa. **A integração com o PDV está em
   pausa:** não construa nem estime nada dela sem pedido explícito.
6. **A conta fica no PDV** (D29). O tablet mostra só a soma do que foi pedido por ele,
   com o aviso de que o valor final é o do caixa. Não construa taxa de serviço, couvert,
   `payment_intents` nem recebimento.
7. **A mesa não expira** (D26). Ela fecha quando a última comanda é encerrada ou migrada
   (JM-208, JM-209), ou pelo gerente, com motivo (JM-141). Não construa TTL de sessão.

## Fase atual

**Fase B: pedido, tela da equipe e comandas** (prompt 3). A Fase A está fechada e é marco
interno, não subida a produção.

A primeira subida acontece no fim da **Fase B**, com o pedido funcionando (D16), depois do
OK do dono do produto. Não anuncie "produção" antes disso.

**Decisões de 21/09/2026:** fechar todas as fases, parando e reportando ao fim de cada
prompt; **o piloto (Fase D) começa com um aparelho só**, e mais aparelhos entram se ele
passar; **a integração com o PDV segue em pausa**.

**Decisões de 22/09/2026, que substituem a hospedagem decidida em 21/09:** nada de Supabase
Cloud e Vercel. **Tudo roda no servidor do dono do produto**, com Supabase auto-hospedado em
Docker e o Next em imagem própria (`infra/`). HTTPS, backup diário para fora do servidor,
restauração testada e atualização passam a ser nossa responsabilidade. **O piloto começa
logo depois da subida**, antes da Fase C, e o alerta de erro (NF-009) vai para o Telegram. O
Jardim Secreto usa **comanda com nome** (`tab_mode = 'nomeada'`). **Ainda não há domínio:**
o tablet de produção só é pareado quando ele existir, porque o token vive no
armazenamento local por origem.

Requisitos da Fase A: `JM-001..009`, `JM-190`, `JM-050..052`, `JM-055`, `JM-060..064`,
`JM-180`, `NF-001`, `NF-004`, `NF-005`, `NF-006`, `NF-007`, `NF-008`, `NF-009`,
`NF-010`, `NF-011`, `NF-012`. O pareamento do tablet e o cardápio só leitura no aparelho
vieram para a Fase A (P8).

**A Fase B mudou de tamanho na v1.8.** Além do pedido, ela leva a tela da equipe (JM-121,
JM-122), encerrar comanda (JM-208), migrar comanda de mesa (JM-209), fechar mesa pelo
gerente (JM-141) e os dois caminhos de cancelamento (JM-033, JM-111).

Nada das Fases C ou D. Nada dos módulos J (§5.10), K (§5.11) e **O (§5.13, canal
celular)**. Nada do apêndice §17. Nada de integração com PDV, que está em pausa. Do
Módulo N, a Fase B leva JM-200 a JM-203, JM-208 e JM-209.

**Módulo L, cardápio inteligente (§5.14), Fase B.1.** Existe desde 23/09/2026, quando o
adendo 01 foi incorporado, e **nada dele entra na Fase B nem na primeira subida a produção**
(D34): ele é construído em paralelo ao piloto e sobe na primeira atualização depois da
produção. É a barra de destaque no topo, a sugestão de combinação no momento do pedido e a
jornada de consumo. Três regras dele são invioláveis: **a sugestão nunca atrasa nem bloqueia
o pedido** (ela aparece depois de o item entrar na sacola, e o envio funciona igual com o
painel aberto); **nada é adicionado sem toque explícito do cliente** (nenhuma function do
módulo escreve pedido, item ou comanda); e **a IA nunca entra no caminho do toque** (ela
roda em lote, propõe, e uma pessoa aprova no admin, A20). O interruptor do motor por loja e
por mesa (JM-247) é requisito, não conveniência, e nasce desligado.

> **Sobre hardware:** o desenvolvimento e o teste da Fase A precisam de **um** tablet,
> não de onze. Se ele ainda não existir, siga em emulador com a resolução alvo e
> **diga** que a medição de NF-001 está pendente. Não meça desempenho em desktop e
> chame de aceite.

## As seis regras invioláveis

1. **Nenhuma escrita de cliente sem `device_token` verificado no servidor.** Na Fase B,
   `/api/orders` e as rotas `/api/tablet/*` exigem `X-Device-Token`, conferido na
   function do banco, e o pedido exige `Idempotency-Key`. `/api/staff/orders` só nasce na
   Fase C (JM-110). O único caminho de escrita anônima é `/api/track`. O pareamento do
   tablet não é anônimo: exige o login do dono ou do gestor no corpo da requisição.
2. **RLS ativa em toda tabela, sem policy de INSERT para `anon`** (NF-005). Toda tabela
   nova nasce com `enable row level security` no próprio DDL.
3. **Nenhum segredo enumerável por API** (NF-006). `devices.token_hash` fica fora de
   toda view e resposta. O token em claro existe uma única vez, na resposta do
   pareamento, e nunca em URL, log ou outra resposta. Desde 21/09/2026 o pareamento é
   feito no próprio tablet (`/[loja]/tablet/setup`), com o login do dono ou do gestor,
   sem QR e sem código; o login é encerrado no servidor e nenhum cookie da equipe fica no
   aparelho (JM-180 revisto).
4. **`service_role` nunca faz escrita de domínio e nunca aparece sob `NEXT_PUBLIC_`**
   (§4 regra 3). Há teste de grep do bundle publicado na §9.4.
5. **Fuso horário e fronteira de turno sempre no banco** (D12, função `shift_date`).
   Nenhum cálculo de "dia" ou de horário de funcionamento em JavaScript.
6. **Preço sempre no servidor** (JM-031). O front exibe; a function calcula. Vale
   inclusive na Fase A, onde ainda não há envio de pedido: o total do item com
   complementos já sai do banco, para a Fase B não refazer.

## Stack, decidida, não reabrir

- Next.js 15 (App Router) + React + TypeScript estrito (NF-010: `tsc --noEmit` limpo)
- Tailwind 4, com os tokens de cor da loja em CSS variables
- Supabase: Postgres, Auth, Storage, Realtime
- `@supabase/ssr` com `createServerClient` para o login do admin, com a chave `anon`
  sob RLS. **Não** usar `auth-helpers`, descontinuado
- `qrcode` para o QR da plaquinha da mesa, na Fase C. O tablet não usa mais QR de
  configuração: o pareamento é pelo login, no próprio aparelho (21/09/2026). `jsQR` **não**
  é necessário: nenhuma tela do produto lê QR pela câmera, quem lê a plaquinha é o app de
  câmera do próprio celular do cliente
- Serwist para o service worker (NF-004). **Não** `next-pwa`, parado para App Router
- zod em toda fronteira de entrada
- Vitest, Playwright, pgTAP
- `supabase gen types typescript`: o schema é a fonte de verdade dos tipos

**Estrutura (D33):** o código fica em `SuperGestor/JardimMenu`, com `front/` (Next.js:
telas e rotas de API finas) e `back/` (TypeScript só de servidor, em MVC: controllers,
services, models, mais `supabase/` com migrações, massa de dados e testes). Um deploy só,
e o `back/` nunca vai para o bundle do navegador.

**Banco de desenvolvimento:** Supabase local, com Docker. Migrações e pgTAP rodam na
máquina e no CI.

**Não usar:** ORM no caminho de escrita (a escrita passa por function `security
definer`, via RPC do `supabase-js`) · gerenciador de estado global · biblioteca de data
para aritmética de fuso · `float` para dinheiro (`numeric(10,2)` no banco,
`Intl.NumberFormat` para exibir).

## Tempo real

O tablet **não** é usuário autenticado do Supabase, então não assina `postgres_changes`:
a RLS bloquearia, e afrouxá-la violaria a regra 2. Na Fase 1 o tablet usa **polling de
10s** em `/api/tablet/resumo`, que autentica por `device_token`. Realtime só nas
telas de equipe, que são autenticadas. Está na §8.6 do documento. Na tela da equipe, o
evento do Realtime só avisa que algo mudou: ela relê o retrato inteiro por `staff_floor`,
com uma releitura de segurança a cada 10 s quando o Realtime cai (NF-003).

Os 10s são o **modo normal**, e não um plano B: os critérios de 2s que a v1.7 tinha no
tablet passaram a 10s (P7). A tela da equipe fica em 2s, com Realtime, e **precisa
funcionar em celular** (D30).

## Layout

**A tela do cliente é responsiva** (decisão do PO em 15/09/2026, JM-007 revisto): a mesma
tela se adapta a celular em pé e deitado, tablet em pé e deitado e notebook, pela matriz
`adaptiveLayout` do `docs/design-system.json`. Em paisagem a partir de 640px, as
categorias ficam na coluna da esquerda; em pé, ou abaixo de 640px, viram pílulas no topo.
A grade vai de 1 a 4 colunas, e a sacola é sempre uma barra inferior. A tela da equipe
também é responsiva (D30).

**O alvo de medição continua sendo o tablet da mesa: paisagem, 1280×800**, com checagem
em 960×600 e 1440×900 (P10). É nele que o NF-001 é medido. A orientação só é travada no
tablet pareado, pelo navegador kiosk (NF-018) e pela tela.

Responsivo não muda acesso: com banco, só o tablet pareado lê e pede (regra 1), e o
cardápio no celular do cliente continua sendo o Módulo O, da Fase C.

Alvos de toque de no mínimo 44px, em qualquer largura: o aparelho da mesa é usado em pé,
por gente com as mãos ocupadas.

## Como reportar

- **Nunca afirme que algo funciona sem ter rodado.** Cole a saída do comando.
- Mudança de escopo, ainda que pequena, é avisada antes.
- Commits em português, um por unidade coerente de trabalho.
- Ao fim de cada etapa, pare e reporte. Não avance sem OK.
