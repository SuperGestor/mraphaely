
/**
 * Catálogo dos erros de regra que as functions do banco levantam (SQLSTATE da classe JM).
 * Cada código tem status HTTP e texto estáveis: é o que o JM-100 pede para cada recusa.
 *
 * A mensagem do banco só é repassada quando ela é informação para o usuário e não expõe
 * nada: JM422 (qual campo está errado) e JM451 (qual produto ficou indisponível, JM-004).
 *
 * Os códigos da Fase B (JMS, JMT, JMC, JMH, JMK, JMW) são os casos de recusa do pedido,
 * um por situação, para a tela do tablet dizer ao cliente o que fazer.
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
  // Fase B, pedido e comanda (JM-100, JM-202)
  JMS01: { status: 404, mensagem: "Esta mesa ainda não foi aberta. Toque no cardápio para começar." },
  JMS02: { status: 409, mensagem: "A mesa foi encerrada pela equipe. Toque no cardápio para começar de novo." },
  JMS03: { status: 403, mensagem: "Esta abertura é de outra mesa." },
  JMT01: { status: 404, mensagem: "Comanda não encontrada." },
  JMT02: { status: 409, mensagem: "Esta comanda foi encerrada. Abra outra para continuar pedindo." },
  JMT03: { status: 403, mensagem: "Esta comanda é de outra mesa." },
  JMT04: { status: 409, mensagem: "Já existe uma comanda aberta com esse nome nesta mesa." },
  JMT05: { status: 422, mensagem: "Nesta casa a mesa tem uma comanda só." },
  JMC01: { status: 423, mensagem: "Os pedidos desta mesa estão com a equipe agora. Peça ao garçom." },
  JMH01: { status: 423, mensagem: "A casa está fechada agora. O pedido fica disponível no horário de funcionamento." },
  JMK01: { status: 428, mensagem: "O envio chegou sem identificação. Toque em confirmar de novo." },
  JMW01: { status: 425, mensagem: "O reforço fica disponível 3 minutos depois do chamado." },
  "42501": { status: 403, mensagem: "Sem permissão." },
};

export const SEM_TOKEN: ErroDeRegra = {
  status: 401,
  codigo: "JM401",
  mensagem: CATALOGO.JM401.mensagem,
};

/** O banco escreve sem acento; para o cliente, o nome do produto vai com a frase certa. */
function mensagemRepassada(codigo: string, mensagem: string): string {
  if (codigo === "JM451") {
    const produto = mensagem.replace(/^produto indisponivel:\s*/i, "").trim();
    return produto ? `Produto indisponível agora: ${produto}.` : CATALOGO.JM451.mensagem;
  }
  return mensagem;
}

export function traduzErro(e: { code?: string; message?: string } | null | undefined): ErroDeRegra {
  const codigo = e?.code ?? "";
  const item = CATALOGO[codigo];
  if (!item) {
    return { status: 500, codigo: "JM500", mensagem: "Erro interno." };
  }
  return {
    status: item.status,
    codigo,
    mensagem: item.repassa && e?.message ? mensagemRepassada(codigo, e.message) : item.mensagem,
  };
}
