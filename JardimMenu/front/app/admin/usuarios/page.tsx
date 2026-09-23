"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoreRole, StoreUserRow } from "@/lib/types";
import { ehContaJaExiste, mensagemDe } from "@/lib/admin-source";
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
 */
const PAPEL: Record<StoreRole, { rotulo: string; descricao: string }> = {
  owner: { rotulo: "Dono", descricao: "Tudo, mais usuários da loja" },
  manager: { rotulo: "Gestor", descricao: "Cardápio, mesas, dispositivos, horário e aparência" },
  waiter: { rotulo: "Garçom", descricao: "Disponibilidade de produto; na Fase B, a tela da equipe" },
  kitchen: { rotulo: "Cozinha", descricao: "Sem tela na primeira versão (D24)" },
};
const PAPEIS = Object.keys(PAPEL) as StoreRole[];

export default function AdminUsuarios() {
  const { source, loja, dono } = useAdmin();
  const [usuarios, setUsuarios] = useState<StoreUserRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<StoreRole>("waiter");
  const [enviando, setEnviando] = useState(false);
  /** Oferta de vínculo, criada só quando o convite volta com JMU01. */
  const [vinculo, setVinculo] = useState<{ email: string; papel: StoreRole } | null>(null);
  const [vinculando, setVinculando] = useState(false);

  const carregar = useCallback(() => {
    source
      .usuarios(loja.store_id)
      .then(setUsuarios)
      .catch((e: unknown) => setErro(mensagemDe(e)));
  }, [source, loja.store_id]);

  useEffect(carregar, [carregar]);

  async function convidar() {
    const alvo = email.trim();
    setEnviando(true);
    setAviso(null);
    setVinculo(null);
    try {
      await source.convidar({ store_id: loja.store_id, email: alvo, role: papel });
      setAviso(`Convite enviado para ${alvo}.`);
      setEmail("");
      carregar();
    } catch (e: unknown) {
      setAviso(mensagemDe(e));
      // Só este código abre a oferta de vínculo: o e-mail tem conta no Auth e falta o
      // vínculo com esta loja (JM-052). O e-mail continua no campo, para a pessoa ver de
      // qual conta se trata.
      if (ehContaJaExiste(e)) setVinculo({ email: alvo, papel });
    } finally {
      setEnviando(false);
    }
  }

  /** Vincula a conta que já existe (JM-052). O papel é o que está à vista na oferta. */
  async function vincular() {
    if (!vinculo) return;
    setVinculando(true);
    setAviso(null);
    try {
      await source.rpc("admin_link_existing_user", {
        p_store_id: loja.store_id,
        p_email: vinculo.email,
        p_role: vinculo.papel,
      });
      setAviso(`${vinculo.email} entrou na loja como ${PAPEL[vinculo.papel].rotulo.toLowerCase()}.`);
      setVinculo(null);
      setEmail("");
      carregar();
    } catch (e: unknown) {
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
      carregar();
    } catch (e: unknown) {
      setAviso(mensagemDe(e));
    }
  }

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <>
      <PageHeader titulo="Usuários" descricao="Quem entra no sistema da casa, e com qual papel." />

      {aviso ? (
        <div className="mb-4">
          <Hint>{aviso}</Hint>
        </div>
      ) : null}

      {dono ? (
        <Panel
          titulo="Convidar"
          descricao="A pessoa recebe um e-mail para criar a senha e entra já com o papel escolhido. Se o e-mail já tiver conta, a tela oferece vincular essa conta a esta loja."
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

          {vinculo ? (
            <div className="border-line rounded-input border-2 p-4">
              <h3 className="text-base font-bold">{vinculo.email} já tem conta</h3>
              <p className="text-muted mt-1 text-sm">
                A conta já existe no sistema, então não há convite a enviar. Falta só dar a ela acesso a{" "}
                {loja.nome}, com o papel abaixo. A pessoa entra com a senha que já usa.
              </p>
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
                    {vinculando ? "Vinculando…" : "Vincular esta conta à loja"}
                  </Button>
                  <Button variante="secundario" onClick={() => setVinculo(null)} disabled={vinculando}>
                    Agora não
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
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
