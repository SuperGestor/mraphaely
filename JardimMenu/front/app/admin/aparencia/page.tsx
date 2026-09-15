"use client";

import { useEffect, useState } from "react";
import { checar } from "@/lib/contrast";
import { mensagemDe } from "@/lib/admin-source";
import { useAdmin } from "@/components/admin/AdminContext";
import { Button, Field, Hint, PageHeader, Panel, TextInput } from "@/components/admin/ui";

/**
 * Aparência da loja (JM-009) com a validação de contraste do JM-055, que mede **duas**
 * coisas: a cor primária contra o texto branco sobre ela, e a cor de destaque contra o
 * fundo da tela, 4,5:1 nas duas. A tela sugere o tom mais próximo que passa.
 *
 * A mesma medida é refeita no banco ao gravar: o admin escreve por RPC com o próprio
 * login, e validação só aqui seria contornável.
 */
const TEXTO_SOBRE_PRIMARIA = "#ffffff";
const FUNDO_DA_TELA = "#f6f6f3";

interface Cores {
  primaria: string;
  destaque: string;
  logo: string;
}

export default function AdminAparencia() {
  const { source, loja, gestor } = useAdmin();
  const [original, setOriginal] = useState<Cores | null>(null);
  const [cores, setCores] = useState<Cores | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    source
      .loja(loja.store_id)
      .then((l) => {
        const inicial = { primaria: l.primary_color, destaque: l.accent_color, logo: l.logo_url ?? "" };
        setOriginal(inicial);
        setCores(inicial);
      })
      .catch((e: unknown) => setAviso(mensagemDe(e)));
  }, [source, loja.store_id]);

  if (!cores || !original) {
    return (
      <>
        <PageHeader titulo="Aparência" descricao="Logomarca e as duas cores da loja." />
        {aviso ? <Hint>{aviso}</Hint> : <p className="text-muted">Carregando…</p>}
      </>
    );
  }

  const atual = cores;
  const checagemPrimaria = checar(atual.primaria, TEXTO_SOBRE_PRIMARIA);
  const checagemDestaque = checar(atual.destaque, FUNDO_DA_TELA);
  const valido = Boolean(checagemPrimaria?.passa && checagemDestaque?.passa);
  const sujo = JSON.stringify(atual) !== JSON.stringify(original);

  async function salvar() {
    setSalvando(true);
    setAviso(null);
    try {
      await source.rpc("admin_update_store_appearance", {
        p_store_id: loja.store_id,
        p_primary: atual.primaria,
        p_accent: atual.destaque,
        p_logo_url: atual.logo.trim() || null,
      });
      setOriginal(atual);
      setAviso("Aparência gravada. O tablet troca as cores na próxima vez que carregar o cardápio, sem republicar.");
    } catch (e: unknown) {
      setAviso(mensagemDe(e));
    } finally {
      setSalvando(false);
    }
  }

  const campoDeCor = (
    rotulo: string,
    ajuda: string,
    chave: "primaria" | "destaque",
    checagem: ReturnType<typeof checar>,
    referencia: string,
  ) => (
    <>
      <Field
        rotulo={rotulo}
        ajuda={ajuda}
        erro={checagem && !checagem.passa ? `Contraste de ${checagem.razao}:1 ${referencia}. O mínimo é 4,5:1.` : null}
      >
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={atual[chave]}
            disabled={!gestor}
            onChange={(e) => setCores({ ...atual, [chave]: e.target.value })}
            aria-label={`Escolher ${rotulo.toLowerCase()}`}
            className="jm-touch size-12 cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
          <TextInput
            value={atual[chave]}
            disabled={!gestor}
            onChange={(e) => setCores({ ...atual, [chave]: e.target.value })}
            aria-label={`${rotulo} em hexadecimal`}
            className="max-w-40"
          />
          <span className="text-base font-semibold">{checagem ? `${checagem.razao}:1` : "—"}</span>
        </div>
      </Field>
      {gestor && checagem && !checagem.passa && checagem.sugestao ? (
        <Button variante="secundario" onClick={() => setCores({ ...atual, [chave]: checagem.sugestao! })} className="mb-6">
          Usar o tom mais próximo que passa: {checagem.sugestao}
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        titulo="Aparência"
        descricao="Logomarca e as duas cores da loja. A troca reflete no tablet sem republicar o sistema."
        acao={
          gestor ? (
            <Button onClick={salvar} disabled={!sujo || !valido || salvando}>
              {salvando ? "Gravando…" : "Gravar aparência"}
            </Button>
          ) : undefined
        }
      />

      {aviso ? (
        <div className="mb-4">
          <Hint>{aviso}</Hint>
        </div>
      ) : null}

      <Panel titulo="Cores" descricao="Contraste medido pela régua da WCAG, exigindo 4,5:1 nas duas medidas.">
        <div className="grid gap-8 min-[1100px]:grid-cols-2">
          <div>
            {campoDeCor(
              "Cor primária",
              "Coluna de categorias, botões e títulos. Medida contra o texto branco sobre ela.",
              "primaria",
              checagemPrimaria,
              "com o texto branco",
            )}
            {campoDeCor("Cor de destaque", "Preços e detalhes. Medida contra o fundo da tela.", "destaque", checagemDestaque, "com o fundo da tela")}

            <Field rotulo="Logomarca" ajuda="Endereço de uma imagem. Sem logomarca, o tablet mostra as iniciais sobre a cor primária.">
              <TextInput
                value={atual.logo}
                disabled={!gestor}
                maxLength={500}
                placeholder="https://"
                onChange={(e) => setCores({ ...atual, logo: e.target.value })}
              />
            </Field>
            {!valido ? <Hint>Ajuste a cor que não passa no contraste para poder gravar.</Hint> : null}
          </div>

          {/* Prévia com as mesmas peças do tablet, para a escolha ser vista antes de gravar. */}
          <div>
            <p className="mb-2 text-base font-semibold">Prévia</p>
            <div className="rounded-card overflow-hidden border-2" style={{ borderColor: "var(--jm-line)", background: FUNDO_DA_TELA }}>
              <div className="flex">
                <div className="w-28 p-3 text-white" style={{ background: atual.primaria }}>
                  <p className="text-sm font-semibold">{loja.nome}</p>
                  <p className="mt-3 rounded-full bg-white px-2 py-1 text-center text-xs font-semibold text-black">Tudo</p>
                  <p className="mt-2 text-xs text-white/80">Da brasa</p>
                  <p className="mt-2 text-xs text-white/80">Drinks</p>
                </div>
                <div className="flex-1 p-3">
                  <div className="rounded-card shadow-card bg-white p-3">
                    <p className="text-sm font-semibold">Ancho na brasa</p>
                    <p className="text-muted text-xs">300g, na grelha de carvão.</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-base font-bold" style={{ color: atual.destaque }}>
                        R$ 92,00
                      </span>
                      <span className="rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ background: atual.primaria }}>
                        Escolher
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Panel>
    </>
  );
}
