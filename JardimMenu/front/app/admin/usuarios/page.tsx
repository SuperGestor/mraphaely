"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoreRole, StoreUserRow } from "@/lib/types";
import { mensagemDe } from "@/lib/admin-source";
import { useAdmin } from "@/components/admin/AdminContext";
import { Badge, Button, Cell, Field, Hint, PageHeader, Panel, Row, Table, TextInput } from "@/components/admin/ui";

/**
 * Usuários da loja (JM-052): convite, papel e desativação. Só o dono altera; o gestor vê.
 *
 * Desativar recusa a escrita na hora, porque toda function confere se o usuário está
 * ativo; a leitura cai em até 15 min, que é o tempo de vida do token de login.
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

  const carregar = useCallback(() => {
    source
      .usuarios(loja.store_id)
      .then(setUsuarios)
      .catch((e: unknown) => setErro(mensagemDe(e)));
  }, [source, loja.store_id]);

  useEffect(carregar, [carregar]);

  async function convidar() {
    setEnviando(true);
    setAviso(null);
    try {
      await source.convidar({ store_id: loja.store_id, email: email.trim(), role: papel });
      setAviso(`Convite enviado para ${email.trim()}.`);
      setEmail("");
      carregar();
    } catch (e: unknown) {
      setAviso(mensagemDe(e));
    } finally {
      setEnviando(false);
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
        <Panel titulo="Convidar" descricao="A pessoa recebe um e-mail para criar a senha e entra já com o papel escolhido.">
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
