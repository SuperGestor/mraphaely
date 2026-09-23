/**
 * NF-009: falha na ingestão do pixel e 5xx de qualquer rota (Fase A), e falha de criação
 * de pedido (Fase B, o único aviso de pedido perdido no piloto), geram registro
 * consultável e alerta em canal nomeado.
 *
 * - O registro é uma linha JSON no log do servidor, com o motivo e nunca o conteúdo da
 *   requisição, para o log não virar depósito de dado do cliente (JM-063).
 * - Canal nomeado: TELEGRAM (decisão do PO em 21/09/2026), pela API `sendMessage` do bot,
 *   com `ALERT_TELEGRAM_BOT_TOKEN` e `ALERT_TELEGRAM_CHAT_ID`. O passo a passo para criar
 *   o bot e o grupo está em docs/operacao/alerta-telegram.md.
 * - O `ALERT_WEBHOOK_URL` de 14/09/2026 segue funcionando em paralelo, e no mesmo alerta:
 *   o corpo leva `text` e `content`, então a mesma URL serve Slack, Google Chat e Discord.
 * - No máximo um alerta por minuto por evento, somando os canais: uma falha em rajada não
 *   afoga o grupo. O que ficou de fora da janela é contado e sai no alerta seguinte, para
 *   ninguém subestimar quantos pedidos se perderam.
 * - Alerta nunca derruba a rota: timeout curto, e falha de envio é engolida (fica só uma
 *   linha no log, sem a URL).
 *
 * Segredo (NF-006, regra 3 do CLAUDE.md): o token do bot vive só no servidor, nunca sob
 * `NEXT_PUBLIC_`, e nunca vai para log, nem dentro da URL da API do Telegram, que o
 * carrega no caminho. O mesmo vale para a URL do webhook, que também é credencial.
 */
type Nivel = "erro" | "aviso";

/** Segura o envio depois da resposta (o `after` do Next), instalado pelo instrumentation.ts. */
export type Agendador = (tarefa: Promise<unknown>) => void;

interface EstadoDoAlerta {
  ultimoEnvio: Map<string, number>;
  omitidos: Map<string, number>;
  agendador: Agendador | null;
}

/**
 * O estado mora no `globalThis`, e não no módulo: o instrumentation.ts e as rotas podem
 * carregar cópias diferentes deste arquivo, e o agendador instalado por um precisa valer
 * para as outras, assim como a janela de um minuto.
 */
const CHAVE_DO_ESTADO: unique symbol = Symbol.for("jardim-menu.alerta");

function estado(): EstadoDoAlerta {
  const global = globalThis as typeof globalThis & { [CHAVE_DO_ESTADO]?: EstadoDoAlerta };
  global[CHAVE_DO_ESTADO] ??= { ultimoEnvio: new Map(), omitidos: new Map(), agendador: null };
  return global[CHAVE_DO_ESTADO];
}

const JANELA_MS = 60_000;
/** Curto de propósito: o alerta corre junto da resposta, e não pode segurar a função. */
const TIMEOUT_MS = 3_000;

/** Formato do token do BotFather (`123456:AbC-...`). Fora dele, a URL da API nem é montada. */
const TOKEN_DO_BOT = /^\d{3,20}:[A-Za-z0-9_-]{20,100}$/;
/** Id numérico (o de grupo é negativo) ou @nome de canal público. */
const CHAT_ID = /^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/;

/**
 * O que pode ir no texto do canal, além do nome do evento: só identificadores que o
 * próprio código escreve (código de erro, SQLSTATE, status, padrão da rota, tipo da
 * exceção). Caminho real, corpo, header, nome de comanda e mensagem do banco ficam de
 * fora: o grupo do Telegram é um lugar fora do nosso servidor.
 */
const CAMPOS_DO_TEXTO = ["codigo", "sqlstate", "status", "rota", "erro"] as const;

/** Uma linha em português para o dono do produto, que lê o alerta no celular. */
const EXPLICACAO: Record<string, string> = {
  "pedido.criacao.falhou": "Um pedido do tablet NÃO foi gravado. Confira com as mesas.",
  "servidor.5xx": "Uma tela ou rota quebrou no servidor.",
  "servidor.5xx.banco": "O banco devolveu um erro que o sistema não conhece.",
  "servidor.5xx.sem_banco": "O tablet pediu, e o servidor está sem banco: nada é gravado.",
  "servidor.inicio.sem_banco": "O servidor subiu sem banco configurado.",
  "pixel.ingestao.falhou": "Os eventos de uso do cardápio não foram gravados.",
};

interface Canais {
  webhook: string | null;
  telegram: { token: string; chatId: string } | null;
  /** Alguma das duas variáveis do Telegram existe, mas o par não serve. */
  telegramMalConfigurado: boolean;
}

/** Lido a cada alerta, e não na carga do módulo: o teste troca a variável sem reimportar. */
function lerCanais(): Canais {
  const webhook = process.env.ALERT_WEBHOOK_URL?.trim() || null;
  const token = process.env.ALERT_TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = process.env.ALERT_TELEGRAM_CHAT_ID?.trim() ?? "";

  if (!token && !chatId) return { webhook, telegram: null, telegramMalConfigurado: false };
  if (TOKEN_DO_BOT.test(token) && CHAT_ID.test(chatId)) {
    return { webhook, telegram: { token, chatId }, telegramMalConfigurado: false };
  }
  // Meia configuração é erro de quem instalou, e não motivo para tentar enviar: uma URL
  // montada com token torto vira 404 na API do Telegram a cada falha.
  return { webhook, telegram: null, telegramMalConfigurado: true };
}

/** Só letras, dígitos e a pontuação de rota: nada que o cliente tenha digitado passa. */
function limpo(valor: unknown): string | null {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const texto = String(valor).replace(/[^A-Za-z0-9_./[\]-]/g, "").slice(0, 60);
  return texto || null;
}

function montarTexto(
  evento: string,
  nivel: Nivel,
  detalhe: Record<string, unknown>,
  omitidos: number,
): string {
  const linhas = [`[Jardim Menu] ${nivel}: ${evento}`];
  const explicacao = EXPLICACAO[evento];
  if (explicacao) linhas.push(explicacao);

  const campos = CAMPOS_DO_TEXTO.map((campo) => {
    const valor = limpo(detalhe[campo]);
    return valor ? `${campo} ${valor}` : null;
  }).filter((campo): campo is string => campo !== null);
  if (campos.length) linhas.push(campos.join(" · "));

  if (omitidos > 0) linhas.push(`+${omitidos} ocorrência(s) no último minuto, sem alerta próprio.`);
  return linhas.join("\n");
}

function registrarFalhaDeEnvio(canal: "telegram" | "webhook", causa: string | number) {
  // Nunca a URL: a do Telegram carrega o token do bot, e a do webhook é credencial.
  console.error(
    JSON.stringify({
      quando: new Date().toISOString(),
      nivel: "aviso",
      evento: "alerta.envio.falhou",
      canal,
      causa,
    }),
  );
}

async function enviar(canal: "telegram" | "webhook", url: string, corpo: unknown): Promise<void> {
  try {
    const resposta = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resposta.ok) registrarFalhaDeEnvio(canal, resposta.status);
    // Libera a conexão sem ler a resposta, que não interessa para nós.
    await resposta.body?.cancel().catch(() => undefined);
  } catch (e) {
    // O canal fora do ar não pode virar mais um erro para o cliente. Só o tipo do erro vai
    // para o log: a mensagem do fetch costuma repetir a URL inteira.
    registrarFalhaDeEnvio(canal, e instanceof Error ? e.name : "desconhecida");
  }
}

export async function registrarEAlertar(
  evento: string,
  detalhe: Record<string, unknown> = {},
  nivel: Nivel = "erro",
): Promise<void> {
  const linha = { quando: new Date().toISOString(), nivel, evento, ...detalhe };
  console.error(JSON.stringify(linha));

  const { webhook, telegram, telegramMalConfigurado } = lerCanais();
  // Sem canal nomeado, o registro no log é tudo o que existe, e já está feito.
  if (!webhook && !telegram && !telegramMalConfigurado) return;

  const { ultimoEnvio, omitidos } = estado();
  const agora = Date.now();
  if (agora - (ultimoEnvio.get(evento) ?? 0) < JANELA_MS) {
    omitidos.set(evento, (omitidos.get(evento) ?? 0) + 1);
    return;
  }
  ultimoEnvio.set(evento, agora);
  const quantosOmitidos = omitidos.get(evento) ?? 0;
  omitidos.delete(evento);

  if (telegramMalConfigurado) {
    // Sem o valor das variáveis: diz só que o par não serve, para quem for corrigir.
    console.error(
      JSON.stringify({ quando: linha.quando, nivel: "aviso", evento: "alerta.telegram.mal_configurado" }),
    );
  }

  const texto = montarTexto(evento, nivel, detalhe, quantosOmitidos);
  const envios: Promise<void>[] = [];
  if (telegram) {
    envios.push(
      enviar("telegram", `https://api.telegram.org/bot${telegram.token}/sendMessage`, {
        chat_id: telegram.chatId,
        text: texto,
      }),
    );
  }
  if (webhook) {
    // O webhook é canal nosso, e continua levando o registro inteiro, como desde 14/09.
    envios.push(enviar("webhook", webhook, { text: texto, content: texto, detalhe: linha }));
  }
  await Promise.all(envios);
}

/**
 * Para quem não pode esperar o alerta: o 5xx do `traduzErro`, o 503 de banco ausente e a
 * falha de pedido (NF-009). A linha do log sai na hora; o envio segue depois da resposta,
 * para o alerta não entrar no tempo que o cliente espera (NF-001).
 *
 * Numa função serverless, promessa solta pode ser congelada assim que a resposta sai. Por
 * isso o envio é entregue ao agendador (o `after` do Next), que segura a função até ele
 * terminar. Fora de uma requisição, ou sem agendador, o envio segue solto, como antes.
 */
export function alertarSemBloquear(
  evento: string,
  detalhe: Record<string, unknown> = {},
  nivel: Nivel = "erro",
): void {
  const tarefa = registrarEAlertar(evento, detalhe, nivel).catch(() => undefined);
  const { agendador } = estado();
  if (!agendador) return;
  try {
    agendador(tarefa);
  } catch {
    // `after` fora de requisição lança; o envio já está em andamento de todo jeito.
  }
}

export function instalarAgendador(agendador: Agendador): void {
  estado().agendador = agendador;
}
