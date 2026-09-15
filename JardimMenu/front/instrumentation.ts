/**
 * NF-009: erro de servidor em QUALQUER rota gera registro consultável e alerta em canal
 * nomeado. O Next chama `onRequestError` para toda exceção não tratada em rota, página,
 * server action e middleware, então a cobertura não depende de cada rota lembrar.
 *
 * O registro leva caminho, método e tipo de rota, e nunca corpo, header ou query: o
 * `X-Device-Token` e o código de pareamento não podem cair em log (NF-006).
 */
export async function register() {
  // Nada a inicializar: o alerta é montado sob demanda.
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
