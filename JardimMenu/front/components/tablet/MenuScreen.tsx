"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Menu, MenuProduct, StoreHours } from "@/lib/types";
import { getMenuSource } from "@/lib/menu-source";
import { TabletNaoPareado } from "@/lib/tablet-source";
import { iniciarPixel, registrarEvento, registrarImpressao, renovarSessao } from "@/lib/pixel";
import { money } from "@/lib/money";
import { paraOEnvio, PedidoRecusado, rotuloDeItens, type EscolhaDoModal } from "@/lib/sacola";
import { FeaturedCard, ProductCard } from "./ProductCard";
import { ProductModal } from "./ProductModal";
import { CartDrawer } from "./CartDrawer";
import { OrderReview, OrderSent } from "./OrderReview";
import { useSacola } from "./useSacola";
import { KioskShell } from "./KioskShell";
import { EmptyState, ErrorState, OfflineBanner, SkeletonGrid } from "@/components/ui/States";

/**
 * Tela do cliente. Responsiva desde 15/09/2026 (JM-007 revisto), pela matriz
 * `adaptiveLayout` do design system:
 *
 * - em paisagem a partir de 640px (tablet deitado, notebook, celular deitado), as
 *   categorias ficam na coluna da esquerda, com logo, nome da loja e mesa. A coluna pode
 *   ser minimizada, para sobrar espaço para o cardápio;
 * - em pé, ou abaixo de 640px, uma linha com loja e mesa, e as categorias num menu ☰;
 * - a grade vai de 1 coluna (celular em pé) a 4 (tela grande);
 * - a sacola é sempre uma barra inferior, deslocada pela coluna quando ela existe.
 *
 * Coluna minimizada e menu aberto vivem só na memória da tela: o tablet é compartilhado
 * (JM-183). A página /privacidade segue publicada, mas sem link nesta tela, por decisão do
 * PO em 15/09/2026 (NF-008 em divergência).
 *
 * O alvo de medição segue sendo o tablet da mesa, paisagem 1280x800 (P10). As cores da loja
 * entram como CSS variables no elemento raiz (JM-009).
 *
 * Com a fonte real ligada, a mesa vem do dispositivo, e tablet não pareado cai numa tela
 * que manda chamar a equipe (JM-181). A sacola vive só na memória desta tela (JM-183). Na
 * fonte de exemplo o envio é demonstração; na real, o envio e o botão de garçom chegam na
 * Fase B.
 */

/** Rótulo do dia de abertura sem aritmética de calendário: o número vem do banco. */
function quandoAbre(h: StoreHours): string {
  if (!h.opens_at_local) return "";
  const dia =
    h.opens_day_offset === null || h.opens_day_offset === 0
      ? "hoje"
      : h.opens_day_offset === 1
        ? "amanhã"
        : `em ${h.opens_day_offset} dias`;
  return `, abre ${dia} às ${h.opens_at_local}`;
}

function IconeSacola() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8h12l-1 12H7L6 8Z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
    </svg>
  );
}

function IconeMenu() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function MenuScreen({ mesa }: { mesa: number | null }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [horario, setHorario] = useState<StoreHours | null>(null);
  const [erro, setErro] = useState(false);
  const [naoPareado, setNaoPareado] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<MenuProduct | null>(null);
  const [colunaMinimizada, setColunaMinimizada] = useState(false);
  /** Menu ☰ de categorias, no celular. */
  const [menuAberto, setMenuAberto] = useState(false);
  const grade = useRef<HTMLDivElement | null>(null);

  const sacola = useSacola();
  /** Chave da linha da sacola em edição no modal. */
  const [editando, setEditando] = useState<string | null>(null);
  const [sacolaAberta, setSacolaAberta] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<number | null>(null);
  const [adicionado, setAdicionado] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setErro(false);
    setNaoPareado(null);
    setMenu(null);
    const fonte = getMenuSource();
    fonte
      .getMenu("jardim-secreto")
      .then(async (m) => {
        setMenu(m);
        setHorario(await fonte.getHours(m.store.id));
      })
      .catch((e: unknown) => {
        if (e instanceof TabletNaoPareado) setNaoPareado(e.message);
        else setErro(true);
      });
  }, []);

  useEffect(carregar, [carregar]);

  // Pixel: liga quando a loja é conhecida, e o page_view é o primeiro evento (JM-060).
  useEffect(() => {
    if (!menu) return;
    const desligar = iniciarPixel(menu.store.id);
    registrarEvento("page_view");
    return desligar;
  }, [menu]);

  useEffect(() => {
    if (!menu || !categoria) return;
    registrarEvento("category_view", { category_id: categoria });
  }, [menu, categoria]);

  useEffect(() => {
    const atualiza = () => setOffline(!navigator.onLine);
    atualiza();
    window.addEventListener("online", atualiza);
    window.addEventListener("offline", atualiza);
    return () => {
      window.removeEventListener("online", atualiza);
      window.removeEventListener("offline", atualiza);
    };
  }, []);

  // O "adicionado" da barra da sacola some sozinho.
  useEffect(() => {
    if (!adicionado) return;
    const t = setTimeout(() => setAdicionado(null), 2500);
    return () => clearTimeout(t);
  }, [adicionado]);

  // O menu ☰ fecha com Esc.
  useEffect(() => {
    if (!menuAberto) return;
    const fechaComEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuAberto(false);
    };
    window.addEventListener("keydown", fechaComEsc);
    return () => window.removeEventListener("keydown", fechaComEsc);
  }, [menuAberto]);

  const termo = busca.trim().toLocaleLowerCase("pt-BR");

  const visiveis = useMemo(() => {
    if (!menu) return [];
    const base = termo
      ? menu.products.filter((p) => p.name.toLocaleLowerCase("pt-BR").includes(termo))
      : categoria
        ? menu.products.filter((p) => p.category_id === categoria)
        : menu.products;
    return [...base].sort((a, b) => a.sort_order - b.sort_order);
  }, [menu, categoria, termo]);

  // product_impression quando metade do card fica visível, uma vez por produto (JM-060).
  useEffect(() => {
    const raiz = grade.current;
    if (!raiz || visiveis.length === 0) return;

    const observador = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          const id = (e.target as HTMLElement).dataset.produto;
          if (id) registrarImpressao(id);
        }
      },
      { threshold: 0.5 },
    );

    raiz.querySelectorAll<HTMLElement>("[data-produto]").forEach((el) => observador.observe(el));
    return () => observador.disconnect();
  }, [visiveis]);

  function abrirProduto(produto: MenuProduct) {
    registrarEvento("product_click", { product_id: produto.id });
    setAberto(produto);
  }

  function escolherCategoria(id: string | null) {
    setCategoria(id);
    setBusca("");
    setMenuAberto(false);
  }

  function abrirSacola() {
    registrarEvento("cart_open");
    setMenuAberto(false);
    setSacolaAberta(true);
  }

  function confirmarNoModal(produto: MenuProduct, escolha: EscolhaDoModal) {
    setAberto(null);
    if (editando) {
      sacola.substituir(editando, escolha);
      setEditando(null);
      setSacolaAberta(true);
      return;
    }
    sacola.adicionar(produto, escolha);
    registrarEvento("add_to_cart", { product_id: produto.id });
    setAdicionado(produto.name);
  }

  function fecharModal() {
    setAberto(null);
    if (editando) {
      // Cancelar a edição volta para a sacola, de onde o cliente veio.
      setEditando(null);
      setSacolaAberta(true);
    }
  }

  function editarItem(chave: string) {
    const item = sacola.itens.find((i) => i.chave === chave);
    if (!item) return;
    setSacolaAberta(false);
    setEditando(chave);
    setAberto(item.produto);
  }

  function finalizar() {
    setErroEnvio(null);
    setSacolaAberta(false);
    setRevisando(true);
  }

  function voltarDaRevisao() {
    setRevisando(false);
    setSacolaAberta(true);
  }

  async function confirmarPedido() {
    if (enviando) return; // toque duplo não manda duas vezes
    setEnviando(true);
    setErroEnvio(null);
    try {
      const { numero } = await getMenuSource().enviarPedido(paraOEnvio(sacola.itens));
      sacola.esvaziar();
      setRevisando(false);
      setEnviado(numero);
    } catch (e) {
      setErroEnvio(e instanceof PedidoRecusado ? e.message : "O pedido não saiu. Chame a equipe.");
    } finally {
      setEnviando(false);
    }
  }

  // Limpeza depois do envio (JM-183): a sacola já foi zerada, a tela volta ao início e o
  // pixel ganha sessão nova. A limpeza por 3 min de inatividade e o botão "novo cliente"
  // chegam com a Fase B.
  const fecharEnviado = useCallback(() => {
    setEnviado(null);
    setBusca("");
    setCategoria(null);
    setMenuAberto(false);
    renovarSessao();
  }, []);

  const destaques = useMemo(
    () => (menu ? menu.products.filter((p) => p.is_featured) : []),
    [menu],
  );

  const mesaExibida = menu?.table_number ?? mesa;
  const nomeDaLoja = menu?.store.name ?? "Carregando";
  const nomeCategoria = menu?.categories.find((c) => c.id === categoria)?.name ?? "Cardápio";
  const iniciais = (menu?.store.name ?? "JS")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("pt-BR");
  const avisoFechado = horario && !horario.is_open ? `Fechado agora${quandoAbre(horario)}.` : null;
  const itemEditado = editando ? sacola.itens.find((i) => i.chave === editando) : undefined;
  const envio = getMenuSource().envio;
  const tudoAtivo = categoria === null && !termo;

  /** Botões de categoria em lista vertical: na coluna (paisagem) e no menu ☰ (celular). */
  function botoesDeCategoria() {
    const base = "jm-touch jm-focus mb-1 w-full rounded-full px-4 text-left text-base";
    const ativo = "bg-white text-ink font-semibold";
    const inativo = "text-white/90 hover:bg-white/10";
    return [
      <button
        key="tudo"
        type="button"
        onClick={() => escolherCategoria(null)}
        aria-current={tudoAtivo}
        className={`${base} font-semibold ${tudoAtivo ? ativo : inativo}`}
      >
        Tudo
      </button>,
      ...(menu?.categories ?? []).map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => escolherCategoria(c.id)}
          aria-current={categoria === c.id}
          className={`${base} ${categoria === c.id ? ativo : inativo}`}
        >
          {c.name}
        </button>
      )),
    ];
  }

  if (naoPareado) {
    return (
      <main className="jm-kiosk flex h-dvh flex-col items-center justify-center gap-6 p-6 text-center sm:p-10">
        <KioskShell />
        <p className="text-3xl font-bold sm:text-4xl">Chame a equipe</p>
        <p className="text-muted max-w-xl text-lg sm:text-xl">{naoPareado}</p>
        <a href="setup" className="text-muted text-base underline">
          Parear este tablet
        </a>
      </main>
    );
  }

  return (
    <div
      className="jm-kiosk flex h-dvh flex-col overflow-hidden min-[640px]:landscape:flex-row"
      // As duas cores da loja valem para a tela inteira, sem redeploy (JM-009).
      style={
        menu
          ? ({
              "--jm-primary": menu.store.primary_color,
              "--jm-accent": menu.store.accent_color,
            } as React.CSSProperties)
          : undefined
      }
    >
      <KioskShell />

      {/* Paisagem a partir de 640px: coluna de categorias com logo, loja e mesa (JM-007). */}
      <aside
        className={`bg-primary hidden shrink-0 flex-col text-white min-[640px]:landscape:flex ${
          colunaMinimizada ? "w-[76px]" : "w-[220px]"
        }`}
      >
        <div className={`flex items-center gap-3 pt-5 pb-4 ${colunaMinimizada ? "flex-col px-2" : "px-4"}`}>
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-base font-bold">
            {iniciais}
          </div>
          {colunaMinimizada ? (
            mesaExibida !== null ? (
              <p className="text-xs text-white/70">Mesa {mesaExibida}</p>
            ) : null
          ) : (
            <div className="min-w-0 flex-1">
              <p className="truncate text-base leading-tight font-semibold">{nomeDaLoja}</p>
              {mesaExibida !== null ? <p className="text-sm text-white/70">Mesa {mesaExibida}</p> : null}
            </div>
          )}
          <button
            type="button"
            onClick={() => setColunaMinimizada((v) => !v)}
            aria-expanded={!colunaMinimizada}
            aria-label={colunaMinimizada ? "Mostrar as categorias" : "Minimizar as categorias"}
            title={colunaMinimizada ? "Mostrar as categorias" : "Minimizar as categorias"}
            className="jm-touch jm-focus flex shrink-0 items-center justify-center rounded-full px-3 text-lg font-bold hover:bg-white/10"
          >
            {colunaMinimizada ? "»" : "«"}
          </button>
        </div>

        {colunaMinimizada ? null : (
          <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Categorias">
            {botoesDeCategoria()}
          </nav>
        )}
      </aside>

      {/* Em pé, ou abaixo de 640px: uma linha com loja e mesa, e as categorias no menu ☰. */}
      <div className="bg-primary relative z-20 shrink-0 text-white min-[640px]:landscape:hidden">
        <div className="relative z-30 flex items-center gap-3 px-3 py-2">
          <button
            type="button"
            onClick={() => setMenuAberto((v) => !v)}
            aria-expanded={menuAberto}
            aria-controls="categorias-celular"
            aria-label={menuAberto ? "Fechar as categorias" : "Abrir as categorias"}
            className="jm-touch jm-focus flex shrink-0 items-center justify-center rounded-full px-2 hover:bg-white/10"
          >
            {menuAberto ? (
              <span aria-hidden="true" className="w-6 text-center text-xl leading-none">
                ✕
              </span>
            ) : (
              <IconeMenu />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base leading-tight font-semibold">{nomeDaLoja}</p>
            {mesaExibida !== null ? <p className="text-sm text-white/70">Mesa {mesaExibida}</p> : null}
          </div>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-bold">
            {iniciais}
          </div>
        </div>

        {menuAberto ? (
          <>
            <div className="fixed inset-0 z-10 bg-black/35" onClick={() => setMenuAberto(false)} aria-hidden="true" />
            <nav
              id="categorias-celular"
              aria-label="Categorias"
              className="bg-primary shadow-float absolute inset-x-0 top-full z-20 max-h-[70dvh] overflow-y-auto px-3 pt-1 pb-3"
            >
              {botoesDeCategoria()}
            </nav>
          </>
        ) : null}
      </div>

      {/* Conteúdo */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {offline ? <OfflineBanner mesa={mesaExibida} /> : null}

        {avisoFechado ? (
          <div className="bg-accent px-4 py-3 text-white sm:px-6" role="status">
            <p className="text-base font-semibold">{avisoFechado} O cardápio continua navegável.</p>
          </div>
        ) : null}

        <header className="border-line bg-surface flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
          <h1 className="min-w-0 flex-1 truncate text-xl font-bold sm:flex-none sm:text-2xl">
            {termo ? "Busca" : nomeCategoria}
          </h1>
          <div className="order-last flex w-full items-center gap-2 sm:order-none sm:ml-auto sm:w-auto">
            <label htmlFor="busca" className="sr-only">
              Buscar no cardápio
            </label>
            <input
              id="busca"
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar prato ou bebida"
              className="rounded-input border-line bg-canvas jm-touch jm-focus w-full min-w-0 border-2 px-4 text-base sm:w-72"
            />
            {termo ? (
              <button
                type="button"
                onClick={() => setBusca("")}
                className="jm-touch jm-focus bg-canvas shrink-0 rounded-full px-4 text-base font-semibold"
              >
                Limpar
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={abrirSacola}
            aria-label={sacola.quantidade > 0 ? `Sacola, ${rotuloDeItens(sacola.quantidade)}` : "Sacola vazia"}
            className="jm-touch jm-focus bg-canvas relative flex shrink-0 items-center gap-2 rounded-full px-4 text-base font-semibold"
          >
            <IconeSacola />
            Sacola
            {sacola.quantidade > 0 ? (
              <span
                aria-hidden="true"
                className="bg-primary absolute -top-1.5 -right-1.5 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white tabular-nums"
              >
                {sacola.quantidade}
              </span>
            ) : null}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {erro ? (
            <ErrorState onRepetir={carregar} />
          ) : !menu ? (
            <SkeletonGrid />
          ) : (
            <>
              {!termo && categoria === null && destaques.length > 0 ? (
                <section className="mb-6 sm:mb-8">
                  <h2 className="mb-3 text-lg font-semibold">Mais pedidos</h2>
                  <div className="jm-sem-barra flex gap-4 overflow-x-auto pb-2">
                    {destaques.map((p, i) => (
                      <FeaturedCard key={p.id} produto={p} indice={i} onAbrir={abrirProduto} />
                    ))}
                  </div>
                </section>
              ) : null}

              {visiveis.length === 0 ? (
                <EmptyState
                  titulo="Nada com esse nome"
                  texto="Tente outra palavra, ou limpe a busca para ver o cardápio inteiro."
                  acao={{ rotulo: "Limpar a busca", onClick: () => setBusca("") }}
                />
              ) : (
                <div
                  ref={grade}
                  className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 sm:gap-5 min-[1200px]:grid-cols-3 min-[1680px]:grid-cols-4"
                >
                  {visiveis.map((p, i) => (
                    <div key={p.id} data-produto={p.id}>
                      <ProductCard produto={p} indice={i} onAbrir={abrirProduto} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Barra da sacola: quantidade, total do servidor e "Ver pedido" (design system). */}
        {sacola.quantidade > 0 ? (
          <div className="bg-primary flex shrink-0 items-center gap-3 px-4 py-3 text-white sm:gap-4 sm:px-6">
            <p className="min-w-0 flex-1 truncate text-base font-semibold" role="status" aria-live="polite">
              {adicionado
                ? `✓ ${adicionado} na sacola`
                : `${rotuloDeItens(sacola.quantidade)} · ${sacola.total === null ? "calculando…" : money(sacola.total)}`}
            </p>
            <button
              type="button"
              onClick={abrirSacola}
              className="jm-touch jm-focus text-ink shrink-0 rounded-full bg-white px-5 text-base font-bold sm:px-6"
            >
              Ver pedido
            </button>
          </div>
        ) : null}
      </main>

      {aberto ? (
        <ProductModal
          key={editando ?? aberto.id}
          produto={aberto}
          inicial={
            itemEditado
              ? { quantity: itemEditado.quantity, option_ids: itemEditado.option_ids, notes: itemEditado.notes }
              : undefined
          }
          onConfirmar={(escolha) => confirmarNoModal(aberto, escolha)}
          onFechar={fecharModal}
        />
      ) : null}

      {sacolaAberta ? (
        <CartDrawer
          itens={sacola.itens}
          quantidade={sacola.quantidade}
          total={sacola.total}
          onMudarQuantidade={sacola.mudarQuantidade}
          onEditar={editarItem}
          onRemover={sacola.remover}
          onEsvaziar={sacola.esvaziar}
          onFinalizar={finalizar}
          onFechar={() => setSacolaAberta(false)}
        />
      ) : null}

      {revisando ? (
        <OrderReview
          itens={sacola.itens}
          total={sacola.total}
          mesa={mesaExibida}
          envio={envio}
          avisoFechado={avisoFechado}
          offline={offline}
          enviando={enviando}
          erro={erroEnvio}
          onVoltar={voltarDaRevisao}
          onConfirmar={confirmarPedido}
        />
      ) : null}

      {enviado !== null ? (
        <OrderSent
          numero={enviado}
          mesa={mesaExibida}
          demonstracao={envio === "demonstracao"}
          onFechar={fecharEnviado}
        />
      ) : null}
    </div>
  );
}
