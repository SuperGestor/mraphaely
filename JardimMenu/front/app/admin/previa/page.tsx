"use client";

import { useEffect, useRef, useState } from "react";
import { useAdmin } from "@/components/admin/AdminContext";
import { Badge, Button, Hint, PageHeader, Panel, TextInput } from "@/components/admin/ui";

/**
 * Prévia do cliente dentro do painel: a mesma rota que o tablet abre (`/[loja]/tablet`),
 * numa moldura do tamanho de cada aparelho. Não é uma segunda tela do cardápio: se ela
 * divergir da tela do cliente, é defeito.
 *
 * Com o banco ligado, a tela do tablet só abre com um dispositivo pareado, porque quem
 * autoriza a leitura é o token do aparelho (JM-180). Este navegador não tem token, então
 * a prévia mostra o aviso de tablet não pareado, que também é tela de cliente.
 *
 * A tela do cliente é responsiva desde 15/09/2026 (JM-007 revisto). As molduras cobrem o
 * tablet deitado da mesa, que segue sendo o alvo de medição (P10), uma resolução acima e
 * uma abaixo dele, e as outras telas em que ela precisa abrir.
 */
const ALVOS = [
  { rotulo: "1280 × 800", largura: 1280, altura: 800, nota: "tablet deitado, alvo de medição (P10)" },
  { rotulo: "800 × 1280", largura: 800, altura: 1280, nota: "tablet em pé" },
  { rotulo: "1366 × 768", largura: 1366, altura: 768, nota: "notebook" },
  { rotulo: "390 × 844", largura: 390, altura: 844, nota: "celular em pé" },
  { rotulo: "844 × 390", largura: 844, altura: 390, nota: "celular deitado" },
  { rotulo: "960 × 600", largura: 960, altura: 600, nota: "uma abaixo do alvo" },
  { rotulo: "1440 × 900", largura: 1440, altura: 900, nota: "uma acima do alvo" },
];

export default function AdminPrevia() {
  const { loja, source } = useAdmin();
  const [alvo, setAlvo] = useState(ALVOS[0]);
  const [mesa, setMesa] = useState("7");
  const [recarga, setRecarga] = useState(0);
  const caixa = useRef<HTMLDivElement | null>(null);
  const [larguraDisponivel, setLarguraDisponivel] = useState(880);

  // A moldura cabe na largura real do painel, que muda do celular ao monitor.
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setLarguraDisponivel(Math.max(200, el.clientWidth));
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  const url = `/${loja.slug}/tablet?mesa=${encodeURIComponent(mesa || "7")}`;
  // Cabe na largura do painel e numa altura razoável, para a moldura em pé não virar poste.
  const escala = Math.min(1, larguraDisponivel / alvo.largura, 760 / alvo.altura);

  return (
    <>
      <PageHeader
        titulo="Prévia do cliente"
        descricao="A mesma tela que o cliente vê, na moldura de cada aparelho."
        acao={
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-28">
              <TextInput
                value={mesa}
                onChange={(e) => setMesa(e.target.value.replace(/\D/g, ""))}
                aria-label="Número da mesa da prévia"
                inputMode="numeric"
              />
            </div>
            <Button variante="secundario" onClick={() => setRecarga((r) => r + 1)}>
              Recarregar
            </Button>
            <a href={url} target="_blank" rel="noreferrer">
              <Button>Abrir em outra aba</Button>
            </a>
          </div>
        }
      />

      {source.modo === "real" ? (
        <Hint>
          Com o banco ligado, o cardápio só abre num tablet pareado: quem autoriza a leitura é o token do aparelho, e
          este navegador não tem um. Para ver o cardápio real, pareie um tablet em Dispositivos.
        </Hint>
      ) : (
        <Hint>
          A prévia não substitui a medição no aparelho: o desempenho do NF-001 e a rodada exploratória são no tablet
          de verdade, em modo kiosk. Enquanto o modelo não for comprado (A12), a medição fica pendente.
        </Hint>
      )}

      <div className="h-4" />

      <Panel titulo="Moldura" descricao="A tela do cliente é responsiva: escolha o aparelho para ver como ela abre.">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          {ALVOS.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => setAlvo(a)}
              aria-pressed={alvo.rotulo === a.rotulo}
              className={`jm-touch jm-focus rounded-full px-5 text-base font-semibold ${
                alvo.rotulo === a.rotulo ? "bg-primary text-white" : "bg-canvas border-line border-2"
              }`}
            >
              {a.rotulo}
            </button>
          ))}
          <Badge tom="neutro">{alvo.nota}</Badge>
          <span className="text-muted text-sm">exibida a {Math.round(escala * 100)}% do tamanho real</span>
        </div>

        <div ref={caixa} className="w-full">
          <div
            className="border-line bg-canvas rounded-card mx-auto overflow-hidden border-2"
            style={{ width: alvo.largura * escala, height: alvo.altura * escala }}
          >
            <iframe
              key={`${alvo.rotulo}-${mesa}-${recarga}`}
              src={url}
              title="Prévia da tela do cliente"
              width={alvo.largura}
              height={alvo.altura}
              style={{
                width: alvo.largura,
                height: alvo.altura,
                border: 0,
                transform: `scale(${escala})`,
                transformOrigin: "top left",
              }}
            />
          </div>
        </div>
      </Panel>
    </>
  );
}
