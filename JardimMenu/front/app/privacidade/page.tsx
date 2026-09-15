import type { Metadata } from "next";
import { brand } from "@/lib/brand";

/**
 * NF-008, no regime que a loja de fato usa hoje: identificação de cliente desligada.
 * Quando o Módulo J entrar, esta página passa a descrever também nome, telefone, base
 * legal, retenção e canal do titular. O texto tem versão, e a versão é registrada.
 */
export const metadata: Metadata = { title: "Privacidade" };

export default function PrivacidadePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold">Privacidade</h1>
      <p className="text-muted mt-2 text-sm">
        Versão do texto: {brand.privacyTextVersion}
      </p>

      <section className="mt-8 space-y-4 text-base leading-relaxed">
        <h2 className="text-xl font-semibold">O que este tablet coleta</h2>
        <p>
          Este cardápio não pede nome, telefone, e-mail, documento nem qualquer dado que
          identifique você. Não há cadastro, não há login e não há cookie de rastreio.
        </p>
        <p>
          O aparelho registra apenas como o cardápio é usado: quais categorias e produtos
          aparecem na tela, quais são abertos e quanto tempo ficam visíveis. Esses
          registros não têm nome nem identificador de pessoa, e servem para a casa saber
          quais pratos são vistos e quais passam batido.
        </p>
        <p>
          O identificador dessa navegação é sorteado a cada cliente e trocado quando a
          tela volta ao estado inicial, entre um cliente e o próximo. Por isso não é
          possível ligar a navegação de agora à de quem usou o tablet antes.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Observações do pedido</h2>
        <p>
          O campo de observação serve para o preparo, como &ldquo;sem cebola&rdquo;. Não
          escreva ali dados pessoais nem informações de saúde.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Quem é responsável</h2>
        <p>
          O restaurante é o responsável pelos dados da operação. A plataforma que opera
          este cardápio é {brand.operatorLegalName}, e o contato para assuntos de
          privacidade é {brand.supportEmail}.
        </p>
        <p className="text-muted text-sm">
          Nome do operador, contato e domínio ficam provisórios até a decisão de marca do
          produto (A1).
        </p>
      </section>
    </main>
  );
}
