/**
 * NF-009: erro de servidor em QUALQUER rota gera registro consultável e alerta em canal
 * nomeado. São três pontos centrais, e nenhum deles mora nas rotas:
 *
 * 1. `onRequestError`, aqui: o Next o chama para toda exceção não tratada em rota, página,
 *    server action e middleware, então a cobertura não depende de cada rota lembrar;
 * 2. `traduzErro` (back/errors.ts): todo 5xx devolvido de propósito, com o JM500 à frente,
 *    porque todo controller que fala com o banco passa por lá;
 * 3. `register`, aqui: o servidor que sobe sem banco configurado avisa uma vez, em vez de
 *    esperar o primeiro 503 de cada rota.
 *
 * O registro leva caminho, método e tipo de rota, e nunca corpo, header ou query: o
 * `X-Device-Token` e o token do bot não podem cair em log (NF-006).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { alertarSemBloquear, instalarAgendador } = await import("@back/services/alert");
  const { after } = await import("next/server");

  // O envio do alerta sai depois da resposta, para não entrar no tempo que o cliente
  // espera (NF-001). Numa função serverless, promessa solta pode ser congelada assim que a
  // resposta sai; o `after` segura a função até o envio terminar. Ele é injetado, e não
  // importado dentro de back/, porque back/ é TypeScript de servidor e não depende do Next.
  instalarAgendador((tarefa) => after(tarefa));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Em produção isso quer dizer que nada será gravado, e que toda rota vai responder 503;
    // no ambiente de exemplo é o normal, e ninguém configura canal de alerta lá.
    alertarSemBloquear("servidor.inicio.sem_banco", {}, "aviso");
  }
}

export async function onRequestError(
  erro: unknown,
  requisicao: { path: string; method: string },
  contexto: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registrarEAlertar } = await import("@back/services/alert");
  const caminho = requisicao.path.split("?")[0];

  await registrarEAlertar("servidor.5xx", {
    metodo: requisicao.method,
    caminho,
    rota: contexto.routePath,
    tipo: contexto.routeType,
    erro: erro instanceof Error ? erro.name : "desconhecido",
    mensagem: erro instanceof Error ? erro.message.slice(0, 200) : undefined,
  });
}
