// Medição do NF-002: "resposta de envio de pedido percebida como imediata".
//
// Critério de aceite do requisito (§6, NF-002): feedback visual em até 100 ms; p95 da
// resposta do servidor abaixo de 500 ms em 20 execuções, no Wi-Fi do salão.
//
// São dois números, e este script mede **um** deles: a resposta de `POST /api/orders`, do
// início da requisição até o fim da leitura do corpo. O feedback visual de 100 ms é o
// tempo até o pixel mudar depois do toque, e não existe relógio de JavaScript que o meça:
// ele se mede filmando a tela a 60 fps e contando quadros, como está no modelo de registro
// `JardimMenu/docs/qa/nf-002-envio-pedido-AAAA-MM-DD.md`. Rodar só esta bancada e declarar
// NF-002 aceito é aprovar metade do requisito.
//
// ----------------------------------------------------------------------------------
// ISTO CRIA PEDIDOS DE VERDADE
//
// Cada execução cria um pedido no banco, com número sequencial do turno (JM-036), que
// aparece na tela da equipe (JM-121). São 20 pedidos. Isso não é efeito colateral: é a
// medição, porque a resposta repetida do `Idempotency-Key` não grava nada e é rápida
// justamente por isso.
//
// Por isso, duas regras:
//
//   1. Rode em **staging**, que é o caminho normal (NF-012), ou numa **mesa de teste** da
//      casa, com a casa fechada e combinado com quem está no salão.
//   2. No fim, o script lista os pedidos criados. **A equipe precisa cancelá-los**, e o
//      registro da rodada tem campo para dizer quem cancelou.
//
// Nunca rode isto em produção com a casa aberta: os 20 pedidos caem na tela da equipe no
// meio do serviço, e os números do turno são consumidos.
//
// ----------------------------------------------------------------------------------
// O QUE ESTA BANCADA VALE, E O QUE ELA NÃO VALE
//
// Ela mede a perna do servidor a partir do computador onde o Node roda, e não a partir do
// tablet. Rode-a num notebook ligado ao **Wi-Fi do salão**, na mesma rede do tablet: aí ela
// responde "o servidor e o banco cabem no orçamento de 500 ms?".
//
// Ela **não** substitui a medição no tablet, que é a do aceite: o tablet tem outro
// processador, outro rádio e outra pilha de rede, e é ele que o cliente usa. A medição do
// aparelho está no modelo de registro, com o gancho de `fetch` para colar no DevTools
// remoto. A saída daqui entra no registro como bancada, ao lado dela.
//
// ----------------------------------------------------------------------------------
// PASSO A PASSO
//
// Tudo entra por **variável de ambiente**, nunca por argumento de linha de comando: o
// token do tablet é segredo (NF-006), e argumento aparece na lista de processos e no
// histórico do shell. No bash, leia o token sem ecoar e sem gravar no histórico:
//
//     read -rs JM_TOKEN && export JM_TOKEN
//
//  1. **O token de um tablet de TESTE.** O token em claro existe uma vez só, na resposta do
//     pareamento (JM-180, NF-006). Dois caminhos:
//
//     a. Tablet de teste já pareado: ligue nele a depuração remota (o mesmo passo a passo
//        do `medir-nf001.mjs`) e leia, no console do DevTools:
//
//               localStorage.getItem('jm.dt')
//
//     b. Parear um aparelho de teste: abra `/<loja>/tablet/setup` no aparelho e entre com o
//        login do dono ou do gestor. A resposta do pareamento traz o token uma única vez, e
//        ele fica no `localStorage` desse aparelho.
//
//     Nunca use o token de um tablet que está em mesa de cliente, e aposente o dispositivo
//     de teste no admin quando a medição acabar.
//
//  2. **A abertura e a comanda.** Com o token exportado:
//
//         curl -sS -X POST -H "X-Device-Token: $JM_TOKEN" "$JM_URL/api/tablet/abrir"
//         → {"session_id":"…","tab_mode":"mesa_unica","tabs":[{"id":"…","name":"Mesa"}]}
//
//     `session_id` é o JM_SESSION. O JM_TAB sai de `tabs`:
//       · em `mesa_unica`, a comanda já vem criada, e é `tabs[0].id`;
//       · em `nomeada` com `tabs` vazio, crie uma:
//
//         curl -sS -X POST -H "X-Device-Token: $JM_TOKEN" -H "content-type: application/json" \
//              -d '{"nome":"Medicao"}' "$JM_URL/api/tablet/comanda"
//         → {"id":"…","name":"Medicao","session_id":"…"}
//
//  3. **O produto.** No cardápio do próprio tablet:
//
//         curl -sS -H "X-Device-Token: $JM_TOKEN" "$JM_URL/api/tablet/cardapio"
//
//     Pegue em `products` um item com `"is_available": true` e use o `id` dele. Para
//     medir um pedido do tamanho que o modelo de registro pede (3 itens, um com
//     complemento), passe três ids separados por vírgula em JM_PRODUTO e os ids dos
//     complementos do primeiro item em JM_COMPLEMENTOS (eles saem de
//     `products[].option_groups[].options[].id`).
//
//  4. **Rodar**, de `JardimMenu/front`:
//
//         export JM_URL=https://staging-do-salao
//         export JM_SESSION=... JM_TAB=... JM_PRODUTO=...
//         node scripts/medir-nf002.mjs
//
//     Opcionais:
//       JM_COMPLEMENTOS=uuid,uuid  complementos do primeiro item (padrão: nenhum)
//       JM_QUANTIDADE=1            quantidade de cada item (padrão 1)
//       JM_EXECUCOES=20            quantos pedidos (o requisito pede 20; é o padrão)
//       JM_LIMITE_P95_MS=500       o corte do requisito. Mexer nele muda o que "passou"
//                                  quer dizer: só para ensaio, e o registro tem de dizer
//       JM_PAUSA_MS=1000           respiro entre um pedido e o outro. Zero vira rajada, que
//                                  mede fila de conexão, e não o toque de um cliente
//       JM_ESPERA_MS=15000         limite de espera de cada requisição
//
//  5. Guardar a saída inteira no registro da rodada: copie
//     `JardimMenu/docs/qa/nf-002-envio-pedido-AAAA-MM-DD.md` com a data do dia no nome, cole
//     a saída na seção da resposta do servidor e preencha o aparelho, a rede e a mesa. E
//     **meça também o feedback visual**, filmando a tela, ou o NF-002 fica pela metade.
import { randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * Toda entrada validada (regra do projeto), inclusive a que vem do ambiente. O formato do
 * token é o mesmo que o servidor exige (`services/device-token.ts`): 128 bits em base64url,
 * 22 caracteres. Conferir aqui evita gastar 20 pedidos para descobrir que o token estava
 * truncado no copiar e colar.
 */
const listaDeUuids = (rotulo, maximo) =>
  z
    .string({ error: `${rotulo}: falta esta variável de ambiente` })
    .trim()
    .transform((valor) => valor.split(",").map((parte) => parte.trim()).filter(Boolean))
    .pipe(z.array(z.uuid(`${rotulo}: cada id precisa ser um uuid`)).min(1).max(maximo));

const entrada = z
  .object({
    JM_URL: z
      .string({ error: "JM_URL: falta esta variável de ambiente" })
      .url("JM_URL precisa ser o endereço do servidor, com http ou https"),
    JM_TOKEN: z
      .string({ error: "JM_TOKEN: falta esta variável de ambiente" })
      .regex(/^[A-Za-z0-9_-]{22}$/, "JM_TOKEN não tem formato de token de tablet (22 caracteres)"),
    JM_SESSION: z.uuid("JM_SESSION é o session_id devolvido por /api/tablet/abrir"),
    JM_TAB: z.uuid("JM_TAB é o id da comanda aberta"),
    JM_PRODUTO: listaDeUuids("JM_PRODUTO", 50),
    JM_COMPLEMENTOS: listaDeUuids("JM_COMPLEMENTOS", 50).optional(),
    JM_QUANTIDADE: z.coerce.number().int().min(1).max(20).default(1),
    JM_EXECUCOES: z.coerce.number().int().min(1).max(200).default(20),
    JM_LIMITE_P95_MS: z.coerce.number().int().positive().default(500),
    JM_PAUSA_MS: z.coerce.number().int().min(0).max(60_000).default(1000),
    JM_ESPERA_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  })
  .safeParse(process.env);

if (!entrada.success) {
  console.error("Entrada inválida:");
  for (const problema of entrada.error.issues) {
    console.error(`  ${problema.path.join(".") || "(ambiente)"}: ${problema.message}`);
  }
  console.error("\nTudo vem do ambiente, nunca da linha de comando: o token é segredo (NF-006).");
  console.error("Veja o passo a passo no começo deste arquivo.");
  process.exit(2);
}

const {
  JM_URL: ENDERECO,
  JM_TOKEN: TOKEN,
  JM_SESSION: SESSAO,
  JM_TAB: COMANDA,
  JM_PRODUTO: PRODUTOS,
  JM_COMPLEMENTOS: COMPLEMENTOS,
  JM_QUANTIDADE: QUANTIDADE,
  JM_EXECUCOES: EXECUCOES,
  JM_LIMITE_P95_MS: LIMITE_P95,
  JM_PAUSA_MS: PAUSA,
  JM_ESPERA_MS: ESPERA,
} = entrada.data;

const URL_DO_PEDIDO = new URL("/api/orders", ENDERECO).toString();

/**
 * O mesmo formato que o servidor e o banco exigem (`controllers/tablet.ts`). Está repetido
 * aqui de propósito: esta bancada fala HTTP com o servidor publicado, como o tablet fala, e
 * não importa código do `back/`. Se um dos dois mudar, a medição falha na primeira execução
 * e não em silêncio.
 */
const CHAVE_DE_IDEMPOTENCIA = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Chave nova a cada execução (JM-032). Repetir a chave na mesma abertura devolve o pedido
 * que já existe, sem gravar nada: seria uma resposta bem mais rápida, medindo outra coisa.
 */
function novaChave() {
  const chave = `nf002-${Date.now().toString(36)}-${randomUUID()}`;
  if (!CHAVE_DE_IDEMPOTENCIA.test(chave)) throw new Error(`chave de idempotência fora do formato: ${chave}`);
  return chave;
}

/**
 * O corpo do pedido: só identificadores, quantidade e observação. Preço não existe neste
 * contrato, porque quem calcula é o banco (JM-031).
 *
 * A observação vai só no primeiro item, com o texto da medição: é o que faz os 20 pedidos
 * se reconhecerem na tela da equipe na hora de cancelar.
 */
function corpoDoPedido() {
  return {
    session_id: SESSAO,
    tab_id: COMANDA,
    items: PRODUTOS.map((produto, indice) => ({
      product_id: produto,
      quantity: QUANTIDADE,
      option_ids: indice === 0 ? (COMPLEMENTOS ?? []) : [],
      notes: indice === 0 ? "medicao NF-002" : null,
    })),
  };
}

/**
 * Percentil por posto mais próximo (nearest-rank): ordena e pega o k-ésimo, com
 * k = teto(p × n). Em 20 execuções, o p95 é o 19º valor, e o p50, o 10º. É o método mais
 * conservador dos usuais: não interpola, então nunca inventa um número menor que um medido
 * de verdade. É o mesmo do `medir-nf001.mjs`, para os dois registros compararem igual.
 */
function percentil(valores, p) {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const posto = Math.max(1, Math.ceil(p * ordenados.length));
  return ordenados[posto - 1];
}

const emMs = (valor) => (valor === null ? "não houve medida" : `${Math.round(valor)} ms`);
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Os pedidos criados até agora, para a equipe saber o que cancelar mesmo se a série parar no meio. */
const criados = [];

function listarOsPedidosCriados() {
  if (criados.length === 0) {
    console.log("\nNenhum pedido chegou a ser criado.");
    return;
  }
  console.log(`\nPedidos criados nesta série (${criados.length}). A equipe precisa cancelar todos:`);
  for (const pedido of criados) console.log(`  nº ${String(pedido.numero).padStart(4)}  ${pedido.id}`);
}

/**
 * Uma execução: manda o pedido e mede a ida e a volta inteiras, inclusive a leitura do
 * corpo. É o que o cliente espera: fila do navegador, rede do salão, trabalho do servidor e
 * volta. A primeira execução costuma carregar a abertura da conexão (DNS, TCP, TLS), e ela
 * fica na série de propósito: descartá-la só melhoraria o número.
 */
async function umaExecucao() {
  const chave = novaChave();
  const inicio = performance.now();
  let resposta;
  let texto;
  try {
    resposta = await fetch(URL_DO_PEDIDO, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // O token vai no cabeçalho, nunca na URL (NF-006).
        "x-device-token": TOKEN,
        "idempotency-key": chave,
      },
      body: JSON.stringify(corpoDoPedido()),
      cache: "no-store",
      signal: AbortSignal.timeout(ESPERA),
    });
    texto = await resposta.text();
  } catch (erro) {
    return { erroDeRede: erro instanceof Error ? erro.message : String(erro) };
  }
  const ms = performance.now() - inicio;

  let corpo = null;
  try {
    corpo = JSON.parse(texto);
  } catch {
    // Resposta sem JSON (um proxy no meio, por exemplo): fica registrado o status e o tempo.
  }
  return { ms, status: resposta.status, corpo };
}

async function medir() {
  console.log(`\nNF-002 · ${URL_DO_PEDIDO}`);
  // A data e a hora entram na saída porque é a saída inteira que vai para o registro da
  // rodada (docs/qa/nf-002-envio-pedido-AAAA-MM-DD.md), e registro sem data não prova nada.
  console.log(`Início: ${new Date().toLocaleString("pt-BR")}`);
  console.log(
    `${EXECUCOES} pedidos de ${PRODUTOS.length} item(ns), quantidade ${QUANTIDADE}` +
      `${COMPLEMENTOS ? `, ${COMPLEMENTOS.length} complemento(s) no primeiro item` : ", sem complemento"}` +
      `, ${PAUSA} ms entre um e outro.`,
  );
  if (PRODUTOS.length < 3 || !COMPLEMENTOS) {
    console.log(
      "AVISO: o modelo de registro pede 3 itens, um deles com complemento. Um pedido menor dá\n" +
        "       menos trabalho ao servidor do que o pedido real, e o número sai otimista.",
    );
  }
  console.log("\n  #     resposta   status   nº do pedido   id");

  const tempos = [];
  const ids = new Set();
  let invalidas = 0;

  for (let i = 1; i <= EXECUCOES; i++) {
    const r = await umaExecucao();
    if (r.erroDeRede) {
      console.error(`\nExecução ${i}: a requisição não completou (${r.erroDeRede}).`);
      console.error("Causas comuns: servidor fora do ar, endereço errado, Wi-Fi caindo na mesa.");
      listarOsPedidosCriados();
      return 1;
    }

    const numero = r.corpo?.display_number ?? null;
    const id = r.corpo?.order_id ?? null;
    console.log(
      `  ${String(i).padStart(3)}   ${Math.round(r.ms).toString().padStart(6)} ms   ${String(r.status).padStart(6)}   ` +
        `${String(numero ?? "—").padStart(12)}   ${id ?? "—"}`,
    );

    if (r.status !== 201) {
      // Recusa de regra (casa fechada, mesa encerrada, produto indisponível) é resposta
      // legítima do JM-100, mas não é uma criação de pedido: medir o tempo dela como se
      // fosse aprovaria o servidor pelo caminho que ele não precisa percorrer.
      console.error(`\nExecução ${i} não criou pedido (HTTP ${r.status}).`);
      if (r.corpo?.codigo) console.error(`Resposta do servidor: ${r.corpo.codigo} — ${r.corpo.mensagem ?? ""}`);
      console.error("A série não vale. Corrija e recomece do zero: p95 de série truncada não é o p95 do requisito.");
      listarOsPedidosCriados();
      return 1;
    }
    if (r.corpo?.replayed === true) {
      // Não deveria acontecer: cada execução gera chave nova. Se acontecer, o tempo medido é
      // o da resposta repetida, que não grava nada.
      console.error(`\nExecução ${i} caiu na resposta repetida do Idempotency-Key, e não criou pedido.`);
      console.error("A série não vale. Confira se JM_SESSION ainda é a abertura viva da mesa.");
      invalidas++;
    }

    if (id) {
      criados.push({ id, numero });
      ids.add(id);
    }
    tempos.push(r.ms);
    if (i < EXECUCOES && PAUSA > 0) await esperar(PAUSA);
  }

  const p50 = percentil(tempos, 0.5);
  const p95 = percentil(tempos, 0.95);
  console.log(`\n  mínimo: ${emMs(percentil(tempos, 0.001))}`);
  console.log(`  p50: ${emMs(p50)}`);
  console.log(`  p95: ${emMs(p95)}   (limite do NF-002: ${LIMITE_P95} ms)`);
  console.log(`  máximo: ${emMs(percentil(tempos, 1))}`);
  console.log(`  pedidos com id distinto: ${ids.size} de ${EXECUCOES}`);

  listarOsPedidosCriados();

  const serieValida = invalidas === 0 && ids.size === EXECUCOES;
  if (!serieValida) {
    console.error("\nA SÉRIE NÃO VALE: nem toda execução criou um pedido novo. Veja a armadilha do");
    console.error("Idempotency-Key no modelo de registro do NF-002.");
    return 1;
  }

  console.log("\nBANCADA: este é o número do servidor, medido do computador onde o Node rodou.");
  console.log("O aceite do NF-002 também exige a medição no tablet e o feedback visual de 100 ms,");
  console.log("que se mede filmando a tela. Veja docs/qa/nf-002-envio-pedido-AAAA-MM-DD.md.");

  const passou = p95 < LIMITE_P95;
  console.log(
    `\n${passou ? "PASSOU" : "FALHOU"}: p95 de ${Math.round(p95)} ms ${passou ? "abaixo" : "igual ou acima"} de ${LIMITE_P95} ms.`,
  );
  return passou ? 0 : 1;
}

/**
 * O código de saída sai por `process.exitCode`, e não por `process.exit()`: no Windows,
 * derrubar o processo com conexão viva do `fetch` faz o libuv abortar ("Assertion failed ...
 * async.c"), e aí quem lê o resultado recebe lixo no lugar de 0 ou 1. Assim o processo
 * termina sozinho quando a conexão em espera fecha, com o código certo. A espera é de
 * segundos; se incomodar, ela é o keep-alive do próprio Node.
 */
medir()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((erro) => {
    console.error(`\nErro na medição: ${erro.message}`);
    listarOsPedidosCriados();
    process.exitCode = 1;
  });
