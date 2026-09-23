// Medição do NF-001: "cardápio interativo em menos de 2s".
//
// Critério de aceite do requisito (§6, NF-001): p95 abaixo de 2s **no tablet real que a
// casa vai usar**, no Wi-Fi do salão, 20 execuções, sobre o cardápio de verdade com as
// fotos de verdade. "Medir em desktop não vale", e é por isso que este script não abre
// navegador nenhum: ele se liga, por depuração remota, ao Chrome que está rodando no
// tablet Android.
//
// ----------------------------------------------------------------------------------
// PASSO A PASSO
//
//  1. Tablet e computador **no Wi-Fi do salão**, o mesmo da casa. Medir em outra rede não
//     vale: metade do NF-001 é a rede.
//  2. No tablet: Ajustes > Sobre > tocar 7 vezes em "Número da versão" para liberar as
//     Opções do desenvolvedor, e ligar lá a "Depuração USB".
//  3. Ligar o tablet no computador por USB e autorizar a chave no diálogo que aparece na
//     tela do tablet ("Permitir depuração USB?"). Deixe a tela do tablet destravada: com o
//     aparelho bloqueado o diálogo não aparece e o adb fica em "unauthorized".
//  4. Conferir que o aparelho apareceu. O `adb` vem do Android SDK Platform Tools, que é um
//     zip avulso do site do Android: não precisa instalar o Android Studio.
//
//         adb devices
//
//     Precisa sair uma linha com o número de série e a palavra `device`. Se sair
//     `unauthorized`, autorize no tablet; se não sair nada, troque de cabo ou de porta USB,
//     porque cabo só de carga não serve.
//
//  5. No tablet, abrir no Chrome a tela do cliente do tablet **já pareado** (JM-180), a
//     mesma que o kiosk abre: https://<servidor-do-salao>/<loja>/tablet
//     Sem pareamento, a tela manda chamar a equipe e não tem cardápio: a medição falha
//     com aviso, e não com número.
//  6. Abrir a ponte de depuração remota, do computador para o Chrome do tablet:
//
//         adb forward tcp:9222 localabstract:chrome_devtools_remote
//
//     A ponte cai quando o cabo sai: depois de desligar e religar o USB, rode o `adb
//     forward` de novo. Se o tablet usar outro navegador Chromium (Chrome Beta, Chrome
//     Dev, WebView do kiosk), o nome do soquete muda — `adb shell cat /proc/net/unix |
//     grep devtools` lista os que existem no aparelho, e é esse nome que vai no comando.
//
//  7. Rodar a medição, de JardimMenu/front, com a MESMA URL que está aberta no tablet:
//
//         NF001_URL=https://<servidor-do-salao>/<loja>/tablet node scripts/medir-nf001.mjs
//
//     Opcionais:
//       NF001_EXECUCOES=20          quantas recargas (o requisito pede 20; é o padrão)
//       NF001_CDP=http://localhost:9222   outra porta, se a do adb forward mudou
//       NF001_LIMITE_P95_MS=2000    o corte do requisito, em ms. Mexer nele muda o que
//                                          "passou" quer dizer: só para ensaio, e o registro
//                                          da rodada tem de dizer que o corte foi outro
//       NF001_LIMPAR_SERVICE_WORKER=1     descadastra o service worker antes de cada
//                                          recarga, para medir o pior caso, com tudo vindo
//                                          da rede (ver "sem cache", abaixo)
//       NF001_PERMITIR_NAO_ANDROID=1      ensaio em emulador ou desktop: a medição roda,
//                                          mas sai marcada como NÃO VALE COMO ACEITE
//  8. Guardar a saída inteira no registro da rodada: copie
//     `JardimMenu/docs/qa/nf-001-cardapio-AAAA-MM-DD.md` com a data do dia no nome e cole a
//     saída lá, com o aparelho, a rede e a mesa preenchidos. Número sem aparelho e sem rede
//     não é aceite de NF-001 (§6).
//
// ----------------------------------------------------------------------------------
// O QUE É "INTERATIVO", AQUI
//
// O relógio começa no início da navegação (`performance.timeOrigin` do documento novo) e
// para no primeiro instante em que **o primeiro card de produto está visível e clicável**:
//
//   a. existe um `[data-produto]` no DOM (a grade do cardápio, MenuScreen);
//   b. o card é um `<button>` que **não** está `disabled` (produto esgotado não conta como
//      clicável, JM-002);
//   c. a caixa dele tem tamanho, cruza a área visível da tela e não está `visibility:
//      hidden`;
//   d. `document.elementFromPoint` no centro visível do card devolve o próprio card ou algo
//      dentro dele, ou seja: nada por cima, nem esqueleto de carregamento, nem modal.
//
// Esse critério é forte de propósito: a grade só existe depois de o JavaScript baixar, o
// React hidratar e o cardápio voltar da fonte de dados (o MenuScreen começa com `menu =
// null` e mostra o esqueleto). Quando o primeiro card aparece e aceita toque, o cliente
// consegue pedir, que é o que o NF-001 quer dizer.
//
// A medição **não** espera a foto do card. Ela é medida e impressa à parte, na coluna
// "foto", para a rodada ficar registrada, mas quem decide passa/não passa é o instante
// interativo. Se o PO entender que "interativo" exige a primeira foto pintada, o corte
// muda para a outra coluna, sem mexer no script (pergunta em aberto no relatório).
//
// ----------------------------------------------------------------------------------
// SEM CACHE
//
// Antes de cada recarga o script limpa o cache HTTP do Chrome e desliga o cache para a
// navegação seguinte (CDP `Network.clearBrowserCache` e `Network.setCacheDisabled`). O
// service worker (NF-004) **não** é mexido por padrão, porque descadastrá-lo muda o estado
// do aparelho da casa: o script só informa, em cada execução, se a página estava sendo
// servida por ele. Para medir o pior caso, com tudo vindo da rede, use
// NF001_LIMPAR_SERVICE_WORKER=1. O registro da rodada deve dizer qual dos dois foi.
import { chromium } from "@playwright/test";
import { z } from "zod";

/** Toda entrada validada (regra do projeto), inclusive a que vem do ambiente. */
const entrada = z
  .object({
    NF001_URL: z
      .string({ error: "NF001_URL: falta esta variável de ambiente" })
      .url("NF001_URL precisa ser a URL da tela do tablet, com http ou https"),
    NF001_EXECUCOES: z.coerce.number().int().min(1).max(200).default(20),
    NF001_CDP: z.string().url().default("http://localhost:9222"),
    NF001_LIMITE_P95_MS: z.coerce.number().int().positive().default(2000),
    NF001_LIMPAR_SERVICE_WORKER: z.enum(["0", "1"]).default("0"),
    NF001_PERMITIR_NAO_ANDROID: z.enum(["0", "1"]).default("0"),
  })
  .safeParse(process.env);

if (!entrada.success) {
  console.error("Entrada inválida:");
  for (const problema of entrada.error.issues) {
    console.error(`  ${problema.path.join(".") || "(ambiente)"}: ${problema.message}`);
  }
  console.error("\nExemplo: NF001_URL=https://servidor-do-salao/jardim-secreto/tablet node scripts/medir-nf001.mjs");
  process.exit(2);
}

const {
  NF001_URL: URL_DO_TABLET,
  NF001_EXECUCOES: EXECUCOES,
  NF001_CDP: ENDERECO_CDP,
  NF001_LIMITE_P95_MS: LIMITE_P95,
  NF001_LIMPAR_SERVICE_WORKER,
  NF001_PERMITIR_NAO_ANDROID,
} = entrada.data;
const LIMPAR_SW = NF001_LIMPAR_SERVICE_WORKER === "1";
const PERMITIR_NAO_ANDROID = NF001_PERMITIR_NAO_ANDROID === "1";

/** Tempo de espera por execução: bem acima do alvo, para o erro ser "não chegou", não "faltou tempo". */
const ESPERA_MAXIMA_MS = 30_000;
/** A foto é registro, não critério: se demorar mais que isto, a execução segue sem ela. */
const ESPERA_DA_FOTO_MS = 10_000;

/**
 * Percentil por posto mais próximo (nearest-rank): ordena e pega o k-ésimo, com
 * k = teto(p × n). Em 20 execuções, o p95 é o 19º valor, e o p50, o 10º. É o método mais
 * conservador dos usuais: não interpola, então nunca inventa um número menor que um
 * medido de verdade.
 *
 * Sem nenhum valor, devolve null: é o caso de nenhuma foto ter chegado a tempo, e imprimir
 * "NaN ms" no registro da rodada seria pior do que dizer que não houve medida.
 */
function percentil(valores, p) {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const posto = Math.max(1, Math.ceil(p * ordenados.length));
  return ordenados[posto - 1];
}

/** Milissegundos arredondados para o relatório, ou o aviso de que não houve medida. */
const emMs = (valor) => (valor === null ? "não houve medida" : `${Math.round(valor)} ms`);

/**
 * Roda no documento novo, antes de qualquer script da página: arma os dois relógios e
 * resolve no primeiro instante em que a condição vale. `performance.now()` já é o tempo
 * desde o início desta navegação, então a conta não passa pelo cabo USB e não sofre com a
 * latência do CDP.
 */
function sondaNaPagina() {
  const naTela = (elemento) => {
    const r = elemento.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    if (getComputedStyle(elemento).visibility === "hidden") return null;
    // Ponto no centro da parte do card que está dentro da janela.
    const esquerda = Math.max(r.left, 0);
    const direita = Math.min(r.right, window.innerWidth);
    const topo = Math.max(r.top, 0);
    const base = Math.min(r.bottom, window.innerHeight);
    if (direita <= esquerda || base <= topo) return null;
    return { x: (esquerda + direita) / 2, y: (topo + base) / 2 };
  };

  const cardClicavel = () => {
    const card = document.querySelector("[data-produto] button:not([disabled])");
    if (!card) return null;
    const ponto = naTela(card);
    if (!ponto) return null;
    const alvo = document.elementFromPoint(ponto.x, ponto.y);
    // Algo por cima (esqueleto, faixa, modal) invalida o toque.
    return alvo && card.contains(alvo) ? card : null;
  };

  const fotoPronta = (card) => {
    const img = card.querySelector("img");
    // Produto sem foto mostra o emoji na paleta (JM-002): não há imagem para esperar.
    if (!img) return true;
    return img.complete && img.naturalWidth > 0;
  };

  const marcas = { interativo: null, foto: null, servicoWorker: null };
  window.__jmNf001 = marcas;

  let avisarInterativo;
  let avisarFoto;
  // Duas promessas separadas de propósito: a foto é registro, e não pode segurar nem
  // derrubar a medição que decide o NF-001.
  window.__jmNf001Interativo = new Promise((resolve) => {
    avisarInterativo = resolve;
  });
  window.__jmNf001Foto = new Promise((resolve) => {
    avisarFoto = resolve;
  });

  let card = null;
  const limite = performance.now() + 60_000;
  const olhar = () => {
    if (marcas.interativo === null) {
      card = cardClicavel();
      if (card) {
        marcas.interativo = performance.now();
        marcas.servicoWorker = Boolean(navigator.serviceWorker && navigator.serviceWorker.controller);
        avisarInterativo(marcas.interativo);
      }
    }
    if (marcas.interativo !== null && marcas.foto === null && card && fotoPronta(card)) {
      marcas.foto = performance.now();
      avisarFoto(marcas.foto);
    }
    // Para de olhar quando as duas marcas saíram, ou depois de um minuto: o tablet fica
    // horas nesta tela, e um rAF eterno é bateria à toa.
    if ((marcas.interativo !== null && marcas.foto !== null) || performance.now() > limite) return;
    requestAnimationFrame(olhar);
  };
  requestAnimationFrame(olhar);
}

/** Confere que do outro lado da porta está mesmo o Chrome de um Android, e não o do computador. */
async function conferirOAparelho() {
  let versao;
  try {
    const resposta = await fetch(`${ENDERECO_CDP}/json/version`);
    versao = await resposta.json();
  } catch (erro) {
    console.error(`Não consegui falar com o Chrome em ${ENDERECO_CDP}: ${erro.message}`);
    console.error("Rode antes:  adb forward tcp:9222 localabstract:chrome_devtools_remote");
    process.exit(2);
  }
  const pacote = versao["Android-Package"];
  console.log(`Aparelho: ${versao.Browser ?? "?"}${pacote ? ` (${pacote})` : ""}`);
  if (!pacote) {
    if (!PERMITIR_NAO_ANDROID) {
      console.error("Isto não é um Chrome de Android. O NF-001 só é aceito no tablet de verdade (§6).");
      console.error("Para ensaiar mesmo assim, em emulador: NF001_PERMITIR_NAO_ANDROID=1");
      process.exit(2);
    }
    console.log("AVISO: não é um Android. Esta rodada é ensaio e NÃO VALE COMO ACEITE do NF-001.");
  }
  return Boolean(pacote);
}

async function medir() {
  const noTablet = await conferirOAparelho();
  const navegador = await chromium.connectOverCDP(ENDERECO_CDP);
  const contexto = navegador.contexts()[0];
  // No Chrome de Android cada aba é uma página já existente: não se abre aba nova por CDP.
  const pagina = contexto?.pages()[0];
  if (!pagina) {
    console.error("Nenhuma aba aberta no Chrome do tablet. Abra a tela do tablet e rode de novo.");
    await navegador.close();
    process.exit(2);
  }

  await pagina.addInitScript(sondaNaPagina);
  const cdp = await contexto.newCDPSession(pagina);
  await cdp.send("Network.enable");

  console.log(`\nNF-001 · ${URL_DO_TABLET}`);
  // A data e a hora entram na saída porque é a saída inteira que vai para o registro da
  // rodada (docs/qa/nf-001-cardapio-AAAA-MM-DD.md), e registro sem data não prova nada.
  console.log(`Início: ${new Date().toLocaleString("pt-BR")}`);
  console.log(`${EXECUCOES} execuções, cache HTTP limpo a cada uma, service worker ${LIMPAR_SW ? "descadastrado" : "como está no aparelho"}.\n`);
  console.log("  #   interativo    foto do 1º card   service worker");

  const tempos = [];
  const tempoDaFoto = [];
  let comServiceWorker = 0;

  for (let i = 1; i <= EXECUCOES; i++) {
    await cdp.send("Network.clearBrowserCache");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    if (LIMPAR_SW) {
      await pagina.evaluate(async () => {
        if (navigator.serviceWorker) {
          const registros = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registros.map((r) => r.unregister()));
        }
        if (window.caches) {
          const nomes = await caches.keys();
          await Promise.all(nomes.map((n) => caches.delete(n)));
        }
      });
    }

    await pagina.goto(URL_DO_TABLET, { waitUntil: "commit", timeout: ESPERA_MAXIMA_MS });
    // A espera mora na página (`page.evaluate` não tem timeout próprio): o que não chegou
    // a tempo volta como null, e aí o script explica em vez de travar.
    const interativo = await pagina.evaluate(
      (espera) => Promise.race([window.__jmNf001Interativo, new Promise((r) => setTimeout(() => r(null), espera))]),
      ESPERA_MAXIMA_MS,
    );
    if (interativo === null) {
      console.error(`\nExecução ${i}: o primeiro card clicável não apareceu em ${ESPERA_MAXIMA_MS / 1000}s.`);
      console.error("Causas comuns: tablet não pareado (a tela manda chamar a equipe), cardápio inteiro esgotado,");
      console.error("servidor fora do ar ou URL diferente da que está aberta no tablet.");
      await navegador.close();
      process.exit(1);
    }
    const foto = await pagina.evaluate(
      (espera) => Promise.race([window.__jmNf001Foto, new Promise((r) => setTimeout(() => r(null), espera))]),
      ESPERA_DA_FOTO_MS,
    );
    const servicoWorker = await pagina.evaluate(() => window.__jmNf001.servicoWorker);

    tempos.push(interativo);
    if (foto !== null) tempoDaFoto.push(foto);
    if (servicoWorker) comServiceWorker++;
    const n = String(i).padStart(3);
    const colunaDaFoto = foto === null ? "não chegou" : `${Math.round(foto)} ms`;
    console.log(
      `  ${n}   ${Math.round(interativo).toString().padStart(7)} ms   ${colunaDaFoto.padStart(13)}   ${servicoWorker ? "servindo" : "não"}`,
    );
  }

  // O cache volta a valer antes de sair: o aparelho é o da casa, e ele continua em uso
  // depois da medição.
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await navegador.close();

  const p50 = percentil(tempos, 0.5);
  const p95 = percentil(tempos, 0.95);
  console.log(`\n  p50 interativo: ${emMs(p50)}`);
  console.log(`  p95 interativo: ${emMs(p95)}   (limite do NF-001: ${LIMITE_P95} ms)`);
  console.log(`  p50 com a 1ª foto: ${emMs(percentil(tempoDaFoto, 0.5))}   (${tempoDaFoto.length} de ${EXECUCOES} execuções)`);
  console.log(`  p95 com a 1ª foto: ${emMs(percentil(tempoDaFoto, 0.95))}`);
  console.log(`  pior caso interativo: ${Math.round(Math.max(...tempos))} ms`);
  console.log(`  execuções servidas pelo service worker: ${comServiceWorker} de ${EXECUCOES}`);

  const passou = p95 < LIMITE_P95;
  if (!noTablet) {
    console.log("\nENSAIO: não foi medido no tablet, então não vale como aceite do NF-001.");
  }
  console.log(`\n${passou ? "PASSOU" : "FALHOU"}: p95 de ${Math.round(p95)} ms ${passou ? "abaixo" : "igual ou acima"} de ${LIMITE_P95} ms.`);
  process.exit(passou ? 0 : 1);
}

medir().catch((erro) => {
  console.error(`\nErro na medição: ${erro.message}`);
  process.exit(1);
});
