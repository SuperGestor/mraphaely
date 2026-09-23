/*
 * RASCUNHO. O texto desta página depende de aprovação do dono do produto (PO), e não vale
 * como definitivo antes dela. Duas consequências, enquanto a aprovação não vem:
 *
 * 1. `brand.privacyTextVersion` continua em 2026-09-11, a versão do texto aprovado (NF-008
 *    pede que o texto tenha versão). Quem aprovar este texto troca a versão em lib/brand.ts
 *    no mesmo dia, senão a página passa a exibir um texto com a versão de outro.
 * 2. Nada de jurídico é afirmado além do que o documento de requisitos decidiu: não há
 *    citação de artigo de lei aqui, de propósito, porque ninguém revisou isso do lado legal.
 */
import type { Metadata } from "next";
import { brand } from "@/lib/brand";

/**
 * NF-008, no regime que a loja de fato usa. Em 21/09/2026 o PO decidiu que o Jardim Secreto
 * usa "comanda com nome" (`tab_mode = 'nomeada'`, JM-200 e JM-201): a mesa é uma abertura só,
 * e cada pessoa abre uma comanda com nome ou apelido só para separar a conta. A versão
 * anterior desta página dizia que o cardápio não pede nome, e isso deixou de ser verdade.
 *
 * - O nome da comanda é rótulo, e não identidade (§5.12): não tem cadastro, nem telefone, nem
 *   vínculo com cliente. Ele aparece na tela da equipe junto do pedido e no tablet da mesa, na
 *   lista de comandas abertas (JM-201, JM-203), e acompanha a comanda quando a equipe a migra
 *   de mesa (JM-209). Trocar o nome é ação da equipe (`staff_rename_tab`).
 * - Base legal por finalidade (NF-013): o nome e as observações servem ao pedido (execução de
 *   contrato); o pixel é legítimo interesse sobre dado que não identifica ninguém.
 * - Retenção pela D32, que é **provisória** (A11): os números da operação ficam sem prazo, e o
 *   nome da comanda e as observações de item são anonimizados em 12 meses. `menu_events` é
 *   expurgado em 12 meses (NF-013). A D32 ajustou a NF-013 e a §18.5, que ainda trazem, em um
 *   trecho, o regime anterior (expurgo junto com o pedido); o texto abaixo segue a D32.
 *   **Atenção:** o expurgo e a anonimização são NF-013, da Fase C. Até eles existirem, esta
 *   página promete um prazo que nenhum job cumpre ainda.
 * - O pixel continua anônimo (JM-063): `menu_sessions` e `menu_events` não têm dispositivo,
 *   mesa nem comanda.
 *
 * A página é uma só para todas as lojas, e o modo de comanda é por loja (JM-200): por isso o
 * texto descreve a comanda com nome, que é o regime do Jardim Secreto, e diz em uma frase o
 * que muda na casa que usa uma conta só por mesa. Se a página passar a ser por loja, a frase
 * sai e cada loja mostra o seu regime.
 *
 * A página segue publicada e **sem link na tela do cliente**, pela decisão do PO de 15/09/2026
 * (NF-008 em divergência): esta revisão é de texto e não mexe nisso.
 */
export const metadata: Metadata = { title: "Privacidade" };

export default function PrivacidadePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold">Privacidade</h1>
      <p className="text-muted mt-2 text-sm">Versão do texto: {brand.privacyTextVersion}</p>

      <section className="mt-8 space-y-4 text-base leading-relaxed">
        <p>
          Esta página explica o que o cardápio no tablet da mesa guarda sobre você, para quê e
          por quanto tempo.
        </p>

        <h2 className="mt-8 text-xl font-semibold">O nome da comanda</h2>
        <p>
          A mesa é aberta uma vez, para todo mundo que está nela, e cada pessoa abre a própria
          comanda, com um nome ou apelido, antes do primeiro pedido. O nome serve só para
          separar a conta: com ele, a equipe sabe de quem é cada pedido, e a conta de cada
          pessoa fecha certo.
        </p>
        <p>
          Pode ser um apelido. O tablet não pede sobrenome, telefone, e-mail, documento nem
          cadastro, e o nome fica só na comanda, junto do que foi pedido nela.
        </p>
        <p>
          Quem vê o nome: a equipe da casa, junto de cada pedido, e quem estiver nesta mesa, no
          tablet dela, enquanto a comanda estiver aberta, porque é pela lista de comandas
          abertas que cada pessoa escolhe a sua. O tablet é da casa e passa de mão em mão:
          quando a tela volta ao início, a sacola é esvaziada e a comanda escolhida deixa de
          estar ativa, mas o nome continua na lista da mesa até a comanda ser encerrada. Se a
          equipe passar a sua comanda para outra mesa, o nome vai junto com ela.
        </p>
        <p>
          Para trocar ou corrigir o nome enquanto a comanda estiver aberta, peça à equipe.
          Quando a casa usa uma conta só para a mesa inteira, o tablet não pede nome nenhum.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Observações do pedido</h2>
        <p>
          O campo de observação serve para o preparo, como &ldquo;sem cebola&rdquo;, e vai para
          a equipe junto com o pedido. Não escreva ali dados pessoais nem informações de saúde.
        </p>

        <h2 className="mt-8 text-xl font-semibold">O que o cardápio registra sobre o uso da tela</h2>
        <p>
          O aparelho registra como o cardápio é usado: quais categorias e produtos aparecem na
          tela, quais são abertos e quanto tempo ficam visíveis. Esses registros não têm nome,
          não sabem a mesa nem a comanda, e não coletam dado pessoal. Servem para a casa saber
          quais pratos são vistos e quais passam batido.
        </p>
        <p>
          O identificador dessa navegação é sorteado a cada cliente e trocado quando a tela
          volta ao estado inicial, entre um cliente e o próximo. Por isso não é possível ligar a
          navegação de agora à de quem usou o tablet antes. Não há login para o cliente e não há
          cookie de rastreio.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Para quê e por quanto tempo</h2>
        <p>
          O nome da comanda e as observações existem para atender o pedido que você fez: a base
          legal é a execução do pedido. O registro de uso da tela não identifica ninguém, e a
          casa o usa por legítimo interesse, para melhorar o cardápio.
        </p>
        <p>
          Os pedidos (o que foi pedido, quando, em qual mesa e por qual valor) ficam guardados
          sem prazo, para os números da casa. O nome da comanda e as observações dos itens são
          anonimizados depois de 12 meses: o pedido continua nos números, sem o nome e sem a
          observação. Os registros de uso da tela são apagados depois de 12 meses.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Quem é responsável</h2>
        <p>
          O restaurante é o responsável pelos dados da operação, inclusive pelo nome da comanda.
          A plataforma que opera este cardápio é {brand.operatorLegalName}, e o contato para
          assuntos de privacidade, inclusive para pedir a correção ou a exclusão do nome de uma
          comanda, é {brand.supportEmail}.
        </p>
        <p className="text-muted text-sm">
          Nome do operador, contato e domínio ficam provisórios até a decisão de marca do
          produto (A1).
        </p>
      </section>
    </main>
  );
}
