"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoreRole, StoreUserRow } from "@/lib/types";
import { casoDoVinculo, ehConflito, ehContaJaExiste, mensagemDe, type CasoDoVinculo } from "@/lib/admin-source";
import { useAdmin } from "@/components/admin/AdminContext";
import { Badge, Button, Cell, Field, Hint, PageHeader, Panel, Row, Table, TextInput } from "@/components/admin/ui";

/**
 * Usuários da loja (JM-052): convite, vínculo de conta que já existe, papel e desativação.
 * Só o dono altera; o gestor vê.
 *
 * Desativar recusa a escrita na hora, porque toda function confere se o usuário está
 * ativo; a leitura cai em até 15 min, que é o tempo de vida do token de login.
 *
 * Conta que já existe: o convite é recusado pelo Auth com JMU01 (back/controllers/
 * usuarios.ts), porque a conta já foi criada em outra loja ou em outro convite. O que
 * falta é só o vínculo com ESTA loja, e é o que `admin_link_existing_user` grava. A tela
 * não vincula sozinha: ela oferece, com o papel à vista, e o dono confirma. Vincular dá
 * acesso à loja, e isso não pode ser efeito colateral de um convite.
 *
 * Desde 24/09/2026 esse mesmo caminho atende TRÊS situações, e a tela precisa dizer qual é
 * antes do toque (`casoDoVinculo`, em lib/admin-source.ts):
 * - quem nunca esteve nesta loja ganha acesso agora;
 * - quem esteve e foi desativado VOLTA, com o papel escolhido aqui, que pode não ser o que
 *   ela tinha — voltar como gestor quem era garçom é mudança de permissão, e o dono tem de
 *   ler isso antes, não descobrir depois;
 * - quem já está ativa segue sendo conflito (JM409), porque mudar papel é na lista de
 *   usuários, e não pode ter um segundo caminho escondido no convite.
 */
const PAPEL: Record<StoreRole, { rotulo: string; descricao: string }> = {
  owner: { rotulo: "Dono", descricao: "Tudo, mais usuários da loja" },
  manager: { rotulo: "Gestor", descricao: "Cardápio, mesas, dispositivos, horário e aparência" },
  waiter: { rotulo: "Garçom", descricao: "Disponibilidade de produto; na Fase B, a tela da equipe" },
  kitchen: { rotulo: "Cozinha", descricao: "Sem tela na primeira versão (D24)" },
};
const PAPEIS = Object.keys(PAPEL) as StoreRole[];

/** Nome do papel no meio da frase: "volta como garçom", e não "volta como Garçom". */
const nomeDoPapel = (papel: StoreRole) => PAPEL[papel].rotulo.toLowerCase();

interface Oferta {
  email: string;
  papel: StoreRole;
  /** Congelado quando a oferta abre: o dono decide sobre o que leu, e não sobre uma lista que mudou embaixo dele. */
  caso: CasoDoVinculo;
}

function tituloDaOferta(oferta: Oferta): string {
  return oferta.caso.tipo === "voltando" ? `${oferta.email} já esteve nesta loja` : `${oferta.email} já tem conta`;
}

function textoDaOferta(oferta: Oferta, nomeDaLoja: string): string {
  if (oferta.caso.tipo === "voltando") {
    return (
      `Essa conta está desativada em ${nomeDaLoja}, onde era ${nomeDoPapel(oferta.caso.papelAnterior)}. ` +
      "Vincular de novo devolve o acesso na hora, com o papel escolhido abaixo. " +
      "A pessoa entra com a senha que já usa."
    );
  }
  if (oferta.caso.tipo === "nova") {
    return (
      "A conta já existe no sistema, então não há convite a enviar. Falta só dar a ela acesso a " +
      `${nomeDaLoja}, com o papel abaixo. A pessoa entra com a senha que já usa.`
    );
  }
  // Sem a lista carregada, dizer "nunca esteve aqui" seria chute. Fala dos dois caminhos.
  return (
    "A conta já existe no sistema, então não há convite a enviar. Se ela já esteve em " +
    `${nomeDaLoja} e foi desativada, o acesso volta; se nunca esteve, ela ganha acesso agora. ` +
    "Nos dois casos vale o papel abaixo, e a pessoa entra com a senha que já usa."
  );
}

/** Só aparece quando a pessoa volta com papel diferente do que tinha: é aí que o acesso dela muda. */
function avisoDeMudancaDePapel(oferta: Oferta): string | null {
  if (oferta.caso.tipo !== "voltando" || oferta.caso.papelAnterior === oferta.papel) return null;
  // O que cada papel pode já está escrito em cada opção da lista abaixo; aqui basta dizer
  // que o acesso dela muda, que é o que o dono precisa ver antes de confirmar.
  return (
    `Ela era ${nomeDoPapel(oferta.caso.papelAnterior)} e vai voltar como ${nomeDoPapel(oferta.papel)}: ` +
    "isso muda o que ela pode fazer na casa."
  );
}

export default function AdminUsuarios() {
  const { source, loja, dono } = useAdmin();
  const [usuarios, setUsuarios] = useState<StoreUserRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<StoreRole>("waiter");
  const [enviando, setEnviando] = useState(false);
  /** Oferta de vínculo, criada só quando o convite volta com JMU01. */
  const [vinculo, setVinculo] = useState<Oferta | null>(null);
  const [vinculando, setVinculando] = useState(false);

  /**
   * Devolve se a lista chegou. Quem escreve espera por ela antes de dizer que deu certo:
   * o dono não recarrega a página à mão, e também não lê "entrou na loja" olhando para uma
   * lista velha. Se a releitura falhar, a mensagem diz isso, em vez de mentir.
   */
  const carregar = useCallback(
    () =>
      source
        .usuarios(loja.store_id)
        .then((lista) => {
          setUsuarios(lista);
          setErro(null);
          return true;
        })
        .catch((e: unknown) => {
          setErro(mensagemDe(e));
          return false;
        }),
    [source, loja.store_id],
  );

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function convidar() {
    const alvo = email.trim();
    setEnviando(true);
    setAviso(null);
    setVinculo(null);
    try {
      await source.convidar({ store_id: loja.store_id, email: alvo, role: papel });
      await carregar();
      setAviso(`Convite enviado para ${alvo}.`);
      setEmail("");
    } catch (e: unknown) {
      // Só este código abre a oferta de vínculo: o e-mail tem conta no Auth e falta o
      // vínculo com esta loja (JM-052). O e-mail continua no campo, para a pessoa ver de
      // qual conta se trata.
      if (!ehContaJaExiste(e)) {
        setAviso(mensagemDe(e));
        return;
      }
      const caso = casoDoVinculo(usuarios, alvo);
      if (caso.tipo === "ja_ativa") {
        // A lista pode estar velha: outro dono, ou outra aba, pode ter desativado a pessoa
        // depois da última leitura. Por isso a tela DIZ o que sabe e mesmo assim oferece o
        // caminho — quem decide é a function, que lê o estado de agora. Fechar aqui deixaria
        // o dono sem saída, olhando uma lista que não bate com o banco.
        setAviso(
          `Pela lista aqui embaixo, ${alvo} já está ativa em ${loja.nome}, como ${nomeDoPapel(caso.papel)}. ` +
            "Se for só isso, mude o papel pela própria lista. Se a lista estiver desatualizada, pode seguir: " +
            "quem confere é o servidor.",
        );
      }
      // A oferta explica o caso; repetir a mensagem do servidor aqui em cima só duplicaria.
      setVinculo({ email: alvo, papel, caso });
    } finally {
      setEnviando(false);
    }
  }

  /** Vincula a conta que já existe (JM-052). O papel é o que está à vista na oferta. */
  async function vincular() {
    if (!vinculo) return;
    const voltando = vinculo.caso.tipo === "voltando";
    setVinculando(true);
    setAviso(null);
    try {
      await source.rpc("admin_link_existing_user", {
        p_store_id: loja.store_id,
        p_email: vinculo.email,
        p_role: vinculo.papel,
      });
      setVinculo(null);
      setEmail("");
      const atualizou = await carregar();
      const feito = voltando
        ? `${vinculo.email} voltou para a loja como ${nomeDoPapel(vinculo.papel)}.`
        : `${vinculo.email} entrou na loja como ${nomeDoPapel(vinculo.papel)}.`;
      setAviso(atualizou ? feito : `${feito} A lista abaixo não recarregou: atualize a página para vê-la.`);
    } catch (e: unknown) {
      if (ehConflito(e)) {
        // A lista estava velha: a conta já tinha acesso. Recarrega para ela aparecer, e
        // diz onde se muda papel.
        setVinculo(null);
        await carregar();
        setAviso(
          `${vinculo.email} já tem acesso a ${loja.nome}. Para mudar o papel, use a lista de usuários aqui embaixo.`,
        );
        return;
      }
      setAviso(mensagemDe(e));
    } finally {
      setVinculando(false);
    }
  }

  async function alterar(u: StoreUserRow, corpo: { acao: "papel"; role: StoreRole } | { acao: "desativar" }) {
    if (corpo.acao === "desativar" && !window.confirm(`Desativar ${u.email}? A escrita dele é recusada na hora.`)) {
      return;
    }
    setAviso(null);
    try {
      await source.alterarUsuario(u.id, corpo);
      await carregar();
    } catch (e: unknown) {
      setAviso(mensagemDe(e));
    }
  }

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const mudancaDePapel = vinculo ? avisoDeMudancaDePapel(vinculo) : null;

  return (
    <>
      <PageHeader titulo="Usuários" descricao="Quem entra no sistema da casa, e com qual papel." />

      <div role="status" aria-live="polite">
        {aviso ? (
          <div className="mb-4">
            <Hint>{aviso}</Hint>
          </div>
        ) : null}
      </div>

      {dono ? (
        <Panel
          titulo="Convidar"
          descricao="A pessoa recebe um e-mail para criar a senha e entra já com o papel escolhido. Se o e-mail já tiver conta, a tela oferece dar acesso a esta loja — inclusive para quem já esteve aqui e foi desativado."
        >
          <div className="grid gap-4 min-[1100px]:grid-cols-[2fr_1fr_auto] min-[1100px]:items-end">
            <Field rotulo="E-mail">
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
            </Field>
            <Field rotulo="Papel">
              <select
                value={papel}
                onChange={(e) => setPapel(e.target.value as StoreRole)}
                className="rounded-input border-line bg-canvas jm-touch jm-focus w-full border-2 px-4 text-base"
              >
                {PAPEIS.map((p) => (
                  <option key={p} value={p}>
                    {PAPEL[p].rotulo}
                  </option>
                ))}
              </select>
            </Field>
            <div className="mb-6">
              <Button onClick={convidar} disabled={!emailValido || enviando}>
                {enviando ? "Enviando…" : "Convidar"}
              </Button>
            </div>
          </div>

          {/* A oferta é a resposta ao toque em Convidar: nasce dentro de uma região viva, para
              quem usa leitor de tela ouvir o que apareceu sem procurar. */}
          <div aria-live="polite">
            {vinculo ? (
              <div className="border-line rounded-input border-2 p-4">
                <h3 className="text-base font-bold">{tituloDaOferta(vinculo)}</h3>
                <p className="text-muted mt-1 text-sm">{textoDaOferta(vinculo, loja.nome)}</p>
                {mudancaDePapel ? (
                  <div className="mt-3">
                    <Hint>{mudancaDePapel}</Hint>
                  </div>
                ) : null}
                <div className="mt-4 grid gap-4 min-[1100px]:grid-cols-[1fr_auto] min-[1100px]:items-end">
                  <Field rotulo="Papel na loja">
                    <select
                      value={vinculo.papel}
                      onChange={(e) => setVinculo({ ...vinculo, papel: e.target.value as StoreRole })}
                      aria-label={`Papel de ${vinculo.email} nesta loja`}
                      className="rounded-input border-line bg-canvas jm-touch jm-focus w-full border-2 px-4 text-base"
                    >
                      {PAPEIS.map((p) => (
                        <option key={p} value={p}>
                          {PAPEL[p].rotulo} — {PAPEL[p].descricao}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="mb-6 flex flex-wrap gap-3">
                    <Button onClick={vincular} disabled={vinculando}>
                      {vinculando
                        ? "Vinculando…"
                        : vinculo.caso.tipo === "voltando"
                          ? "Devolver o acesso a esta pessoa"
                          : "Vincular esta conta à loja"}
                    </Button>
                    <Button variante="secundario" onClick={() => setVinculo(null)} disabled={vinculando}>
                      Agora não
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : (
        <Hint>Só o dono da loja convida, muda papel ou desativa usuários.</Hint>
      )}

      <div className="h-4" />

      <Panel titulo={usuarios ? `${usuarios.length} usuário(s)` : "Usuários"}>
        {erro ? (
          <Hint>{erro}</Hint>
        ) : !usuarios ? (
          <p className="text-muted">Carregando…</p>
        ) : (
          <Table colunas={["E-mail", "Papel", "O que pode", "Estado", ""]}>
            {usuarios.map((u) => (
              <Row key={u.id}>
                <Cell>
                  <span className="font-semibold">{u.email}</span>
                </Cell>
                <Cell>
                  {dono && u.is_active ? (
                    <select
                      value={u.role}
                      onChange={(e) => alterar(u, { acao: "papel", role: e.target.value as StoreRole })}
                      aria-label={`Papel de ${u.email}`}
                      className="rounded-input border-line bg-canvas jm-touch jm-focus border-2 px-3 text-base"
                    >
                      {PAPEIS.map((p) => (
                        <option key={p} value={p}>
                          {PAPEL[p].rotulo}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge tom={u.role === "owner" ? "alerta" : "neutro"}>{PAPEL[u.role].rotulo}</Badge>
                  )}
                </Cell>
                <Cell>
                  <span className="text-muted text-sm">{PAPEL[u.role].descricao}</span>
                </Cell>
                <Cell>{u.is_active ? <Badge tom="ok">Ativo</Badge> : <Badge tom="erro">Desativado</Badge>}</Cell>
                <Cell alinhar="right">
                  {dono && u.is_active ? (
                    <Button variante="secundario" onClick={() => alterar(u, { acao: "desativar" })}>
                      Desativar
                    </Button>
                  ) : null}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
