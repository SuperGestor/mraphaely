/**
 * Sinal de vida do processo, para o monitoramento e para o healthcheck do Docker.
 *
 * Responde 204, sem corpo: nada de versão, nada de nome de ambiente, nada de estado de
 * banco. É rota aberta, então tudo que ela devolvesse seria informação de graça para
 * quem varre a internet (NF-006). Quem responde já prova o que interessa: o Next subiu e
 * está atendendo.
 *
 * De propósito ela NÃO toca no Supabase. Um healthcheck que depende do banco derruba o
 * app inteiro quando o banco tosse, e aí o botão de chamar o garçom (JM-187), que é a
 * única saída humana, cai junto. Banco fora do ar é assunto de alerta (NF-009), não de
 * reinício de contêiner.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
