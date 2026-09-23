import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registrarEAlertar } from "@back/services/alert";

/**
 * NF-009: o alerta é o único aviso de pedido perdido durante o piloto, então ele precisa
 * de teste com o `fetch` simulado. O que se prova aqui:
 *
 * - a chamada do Telegram é montada como a API pede (URL com o token, `chat_id`, `text`);
 * - o texto não carrega token, corpo do pedido nem nome de comanda;
 * - um alerta por minuto por evento, com a contagem do que ficou de fora;
 * - falha de envio é engolida, porque alerta não pode derrubar rota;
 * - sem as variáveis, nada sai do servidor.
 */
const TOKEN = "123456789:AAExemploDeTokenDoBotFather1234567";
const CHAT = "-1001234567890";

/**
 * O estado (janela de um minuto e agendador) mora no `globalThis`, para valer entre as
 * cópias do módulo que o Next carrega. O teste limpa a mesma chave, em vez de o código de
 * produção ganhar um `reset()` que só o teste usaria.
 */
const CHAVE_DO_ESTADO = Symbol.for("jardim-menu.alerta");

function limparEstado() {
  delete (globalThis as Record<symbol, unknown>)[CHAVE_DO_ESTADO];
}

/** Uma resposta de sucesso do jeito que o `enviar` usa: só `ok` e `body`. */
const respostaOk = () => ({ ok: true, status: 200, body: null });

let fetchSimulado: ReturnType<typeof vi.fn>;

beforeEach(() => {
  limparEstado();
  vi.unstubAllEnvs();
  // Só o Date é falso: `AbortSignal.timeout` do envio continua com o timer de verdade.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T20:00:00.000Z"));
  fetchSimulado = vi.fn(async () => respostaOk());
  vi.stubGlobal("fetch", fetchSimulado);
  // O registro no log é esperado em todo alerta; o teste não precisa dele na saída.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  limparEstado();
});

/** Corpo JSON da enésima chamada do fetch. */
function corpoDaChamada(n: number): Record<string, unknown> {
  const [, opcoes] = fetchSimulado.mock.calls[n] as [string, { body: string }];
  return JSON.parse(opcoes.body) as Record<string, unknown>;
}

describe("alerta do NF-009", () => {
  it("sem variável de canal, nada sai do servidor, e o registro no log fica", async () => {
    await registrarEAlertar("servidor.5xx", { rota: "/api/orders" });

    expect(fetchSimulado).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledOnce();
    const linha = JSON.parse(vi.mocked(console.error).mock.calls[0][0] as string) as Record<string, unknown>;
    expect(linha).toMatchObject({ nivel: "erro", evento: "servidor.5xx", rota: "/api/orders" });
  });

  it("monta a chamada do Telegram do jeito que a API sendMessage pede", async () => {
    vi.stubEnv("ALERT_TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("ALERT_TELEGRAM_CHAT_ID", CHAT);

    await registrarEAlertar("pedido.criacao.falhou", { codigo: "JM500", status: 500 });

    expect(fetchSimulado).toHaveBeenCalledOnce();
    const [url, opcoes] = fetchSimulado.mock.calls[0] as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(opcoes.method).toBe("POST");
    expect(opcoes.headers["content-type"]).toBe("application/json");

    const corpo = corpoDaChamada(0);
    expect(corpo.chat_id).toBe(CHAT);
    expect(String(corpo.text)).toContain("pedido.criacao.falhou");
    // A explicação em português é o que o dono do produto lê no celular.
    expect(String(corpo.text)).toContain("NÃO foi gravado");
    expect(String(corpo.text)).toContain("codigo JM500");
  });

  it("o texto do canal não leva token, nome de comanda nem corpo do pedido", async () => {
    vi.stubEnv("ALERT_TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("ALERT_TELEGRAM_CHAT_ID", CHAT);

    await registrarEAlertar("pedido.criacao.falhou", {
      codigo: "JM500",
      comanda: "Mesa da Ana",
      itens: [{ product_id: "0f3d9a6e-0000-4000-8000-000000000001" }],
      token: "segredo-do-dispositivo",
    });

    const texto = String(corpoDaChamada(0).text);
    expect(texto).not.toContain("Ana");
    expect(texto).not.toContain("segredo-do-dispositivo");
    expect(texto).not.toContain("product_id");
    expect(texto).not.toContain(TOKEN);
  });

  it("o webhook antigo continua recebendo, junto do Telegram", async () => {
    vi.stubEnv("ALERT_TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("ALERT_TELEGRAM_CHAT_ID", CHAT);
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://exemplo.invalido/webhook");

    await registrarEAlertar("servidor.5xx.banco", { sqlstate: "XX000" });

    expect(fetchSimulado).toHaveBeenCalledTimes(2);
    expect(fetchSimulado.mock.calls[1][0]).toBe("https://exemplo.invalido/webhook");
    const corpo = corpoDaChamada(1);
    // Slack lê `text` e Discord lê `content`: a mesma URL serve os dois.
    expect(corpo.text).toBe(corpo.content);
  });

  it("par de variáveis do Telegram pela metade não vira chamada", async () => {
    vi.stubEnv("ALERT_TELEGRAM_BOT_TOKEN", "token-torto");
    vi.stubEnv("ALERT_TELEGRAM_CHAT_ID", CHAT);

    await registrarEAlertar("servidor.5xx");

    expect(fetchSimulado).not.toHaveBeenCalled();
    const eventos = vi.mocked(console.error).mock.calls.map((c) => JSON.parse(c[0] as string).evento);
    expect(eventos).toContain("alerta.telegram.mal_configurado");
  });

  it("no máximo um alerta por minuto por evento, e conta o que ficou de fora", async () => {
    vi.stubEnv("ALERT_TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("ALERT_TELEGRAM_CHAT_ID", CHAT);

    await registrarEAlertar("pedido.criacao.falhou", { codigo: "JM500" });
    await registrarEAlertar("pedido.criacao.falhou", { codigo: "JM500" });
    await registrarEAlertar("pedido.criacao.falhou", { codigo: "JM500" });
    expect(fetchSimulado).toHaveBeenCalledOnce();

    // Outro evento na mesma janela tem alerta próprio: a janela é por evento.
    await registrarEAlertar("servidor.5xx", { rota: "/api/tablet/[acao]" });
    expect(fetchSimulado).toHaveBeenCalledTimes(2);

    // Passado o minuto, o alerta seguinte diz quantos pedidos caíram no silêncio.
    vi.setSystemTime(new Date("2026-09-22T20:01:01.000Z"));
    await registrarEAlertar("pedido.criacao.falhou", { codigo: "JM500" });
    expect(fetchSimulado).toHaveBeenCalledTimes(3);
    expect(String(corpoDaChamada(2).text)).toContain("+2 ocorrência(s)");

    // E a contagem zera depois de sair.
    vi.setSystemTime(new Date("2026-09-22T20:02:02.000Z"));
    await registrarEAlertar("pedido.criacao.falhou", { codigo: "JM500" });
    expect(String(corpoDaChamada(3).text)).not.toContain("ocorrência(s)");
  });

  it("falha de envio é engolida, e o log não repete a URL nem o token", async () => {
    vi.stubEnv("ALERT_TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("ALERT_TELEGRAM_CHAT_ID", CHAT);
    fetchSimulado.mockRejectedValue(new TypeError(`fetch failed em https://api.telegram.org/bot${TOKEN}/sendMessage`));

    await expect(registrarEAlertar("pedido.criacao.falhou")).resolves.toBeUndefined();

    const linhas = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    const falha = linhas.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.evento === "alerta.envio.falhou");
    expect(falha).toMatchObject({ canal: "telegram", causa: "TypeError" });
    expect(linhas.join("\n")).not.toContain(TOKEN);
  });

  it("resposta de erro do Telegram vira aviso no log, e não exceção", async () => {
    vi.stubEnv("ALERT_TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("ALERT_TELEGRAM_CHAT_ID", CHAT);
    fetchSimulado.mockResolvedValue({ ok: false, status: 403, body: null });

    await expect(registrarEAlertar("servidor.5xx")).resolves.toBeUndefined();

    const falha = vi
      .mocked(console.error)
      .mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
      .find((l) => l.evento === "alerta.envio.falhou");
    // 403 é o que o Telegram devolve quando o bot não está no grupo: o passo a passo
    // de docs/operacao/alerta-telegram.md existe por causa disso.
    expect(falha).toMatchObject({ canal: "telegram", causa: 403 });
  });
});
