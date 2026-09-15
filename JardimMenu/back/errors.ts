
/**
 * Catálogo dos erros de regra que as functions do banco levantam (SQLSTATE da classe JM).
 * Cada código tem status HTTP e texto estáveis: é o que o JM-100 pede para cada recusa.
 *
 * A mensagem do banco só é repassada quando ela é informação para o usuário e não expõe
 * nada: JM422 (qual campo está errado) e JM451 (qual produto ficou indisponível, JM-004).
 */
export interface ErroDeRegra {
  status: number;
  codigo: string;
  mensagem: string;
}

const CATALOGO: Record<string, { status: number; mensagem: string; repassa?: boolean }> = {
  JM401: { status: 401, mensagem: "Este tablet não está pareado. Chame a equipe." },
  JM403: { status: 403, mensagem: "Seu papel não permite esta ação." },
  JM404: { status: 404, mensagem: "Não encontrado." },
  JM409: { status: 409, mensagem: "Conflito com o estado atual. Recarregue e tente de novo." },
  JM410: { status: 410, mensagem: "Este tablet foi substituído. Chame a equipe." },
  JM422: { status: 422, mensagem: "Dados inválidos.", repassa: true },
  JM423: { status: 423, mensagem: "Este tablet está desativado. Chame a equipe." },
  JM451: { status: 409, mensagem: "Produto indisponível agora.", repassa: true },
  "42501": { status: 403, mensagem: "Sem permissão." },
};

export const SEM_TOKEN: ErroDeRegra = {
  status: 401,
  codigo: "JM401",
  mensagem: CATALOGO.JM401.mensagem,
};

export function traduzErro(e: { code?: string; message?: string } | null | undefined): ErroDeRegra {
  const codigo = e?.code ?? "";
  const item = CATALOGO[codigo];
  if (!item) {
    return { status: 500, codigo: "JM500", mensagem: "Erro interno." };
  }
  return {
    status: item.status,
    codigo,
    mensagem: item.repassa && e?.message ? e.message : item.mensagem,
  };
}
