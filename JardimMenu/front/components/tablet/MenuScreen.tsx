"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Menu, MenuProduct, StoreHours, Uuid } from "@/lib/types";
import { getMenuSource } from "@/lib/menu-source";
import { guardarMesa, lerMesaGuardada, TabletNaoPareado } from "@/lib/tablet-source";
import { iniciarPixel, registrarEvento, registrarImpressao, renovarSessao } from "@/lib/pixel";
import { money } from "@/lib/money";
import { RECUSAS_DE_MESA, type ComandaAberta } from "@/lib/mesa";
import { criarGuardaDeChave } from "@/lib/idempotencia";
import { paraOEnvio, PedidoRecusado, rotuloDeItens, type EscolhaDoModal } from "@/lib/sacola";
import { FeaturedCard, ProductCard } from "./ProductCard";
import { ProductModal } from "./ProductModal";
import { CartDrawer } from "./CartDrawer";
import { OrderReview, OrderSent } from "./OrderReview";
import { useSacola } from "./useSacola";
import { POLLING_MS, useMesa } from "./useMesa";
import { useInatividade } from "./useInatividade";
import { useSaudeDoTablet } from "./useSaudeDoTablet";
import { BotaoGarcom, GarcomProvider } from "./Garcom";
import { ComandaProvider, FaixaDaComanda, SeletorDeComanda } from "./Comanda";
import { ContaDaMesa } from "./ContaDaMesa";
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
 * que manda chamar a equipe (JM-181). A sacola vive só na memória desta tela (JM-183).
 *
 * Fase B, nesta tela:
 * - o primeiro toque abre a abertura da mesa (JM-182), e o polling de 10 s traz a conta, o
 *   chamado e a contingência (JM-012);
 * - o envio sai com a chave de idempotência da sacola (JM-032), na comanda ativa (JM-202);
 * - o botão de garçom fica em toda tela (JM-187), e o "sem conexão" mostra a mesa grande
 *   (JM-185);
 * - a limpeza entre clientes acontece 15 s depois do envio, com 3 min sem toque e pelo
 *   botão "Novo cliente" (JM-183), e zera a comanda ativa (JM-201);
 * - no tablet pareado, watchdog e heartbeat (JM-184).
 *
 * Na fonte de exemplo, tudo isso roda contra a mesa simulada de lib/mock/mesa.ts.
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

function IconeConta() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21V3Z" />
      <path d="M10 8h4M10 12h4" />
    </svg>
  );
}

export function MenuScreen({ loja, mesa: mesaDaUrl }: { loja: string; mesa: number | null }) {
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
  const [enviado, setEnviado] = useState<{ numero: number; comanda: string | null } | null>(null);
  const [adicionado, setAdicionado] = useState<string | null>(null);
  const [contaAberta, setContaAberta] = useState(false);
  /** Seletor de comanda; `paraEnviar` quando aberto pelo "Finalizar" (JM-200). */
  const [seletor, setSeletor] = useState<{ paraEnviar: boolean } | null>(null);
  const [confirmarNovoCliente, setConfirmarNovoCliente] = useState(false);
  const [mesaGuardada, setMesaGuardada] = useState<number | null>(null);
  const conteudo = useRef<HTMLDivElement | null>(null);
  const [guarda] = useState(criarGuardaDeChave);

  const fonte = getMenuSource();
  const real = fonte.envio === "real";
  const mesa = useMesa(menu !== null && naoPareado === null);
  const recusa = naoPareado ?? mesa.naoPareado?.message ?? null;
  useSaudeDoTablet(real && menu !== null && recusa === null);

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

  // A mesa guardada no pareamento, para a tela de erro dizer o número (JM-181).
  useEffect(() => setMesaGuardada(lerMesaGuardada()), []);
  useEffect(() => {
    if (real && menu?.table_number != null) guardarMesa(menu.table_number);
  }, [real, menu]);

  // Pixel: liga quando a loja é conhecida, e o page_view é o primeiro evento (JM-060). Depende
  // só da loja: a releitura do cardápio a cada 10 s não conta como nova visita.
  const lojaId = menu?.store.id ?? null;
  useEffect(() => {
    if (!lojaId) return;
    const desligar = iniciarPixel(lojaId);
    registrarEvento("page_view");
    return desligar;
  }, [lojaId]);

  // Produto marcado indisponível aparece esmaecido em até 10 s (JM-004, P7), e o horário
  // acompanha a abertura e o fechamento da casa (JM-005). O cardápio é relido no ritmo do
  // polling, e só troca na tela quando mudou.
  const cardapioCarregado = menu !== null;
  useEffect(() => {
    if (!cardapioCarregado || naoPareado) return;
    const relogio = setInterval(() => {
      const fonte = getMenuSource();
      fonte
        .getMenu("jardim-secreto")
        .then(async (m) => {
          setMenu((atual) => (atual && JSON.stringify(atual) === JSON.stringify(m) ? atual : m));
          const h = await fonte.getHours(m.store.id);
          setHorario((atual) => (atual && JSON.stringify(atual) === JSON.stringify(h) ? atual : h));
        })
        .catch(() => {
          // Falha aqui não derruba a tela: o polling da mesa já mostra "sem conexão".
        });
    }, POLLING_MS);
    return () => clearInterval(relogio);
  }, [cardapioCarregado, naoPareado]);

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
    // No modo nomeada, o primeiro pedido exige escolher ou criar a comanda (JM-200).
    if (mesa.modo === "nomeada" && !mesa.comandaAtiva) {
      setSeletor({ paraEnviar: true });
      return;
    }
    setRevisando(true);
  }

  function aposEscolher(c: ComandaAberta) {
    mesa.escolherComanda(c);
    const seguirParaRevisao = seletor?.paraEnviar ?? false;
    setSeletor(null);
    if (seguirParaRevisao) setRevisando(true);
  }

  async function criarComanda(nome: string) {
    const c = await mesa.criarComanda(nome);
    aposEscolher(c);
  }

  async function pedirCancelamento(orderId: Uuid, itemId: Uuid | null) {
    await fonte.pedirCancelamento(orderId, itemId);
    void mesa.atualizar();
  }

  function voltarDaRevisao() {
    setRevisando(false);
    setSacolaAberta(true);
  }

  /**
   * Envio (JM-100, JM-032). A abertura e a comanda são as que o tablet conhece; se a
   * equipe mudou alguma delas por fora, o banco recusa com código próprio, e a tela relê a
   * mesa antes da próxima tentativa. A chave de idempotência é a da sacola: tocar de novo
   * depois de uma resposta perdida devolve o mesmo pedido.
   */
  async function confirmarPedido() {
    if (enviando) return; // toque duplo não manda duas vezes
    setEnviando(true);
    setErroEnvio(null);
    try {
      const s = await mesa.garantirMesa();
      const aba =
        mesa.modo === "nomeada" ? mesa.comandaAtiva : (s.tabs.find((t) => t.name === "Mesa") ?? s.tabs[0] ?? null);
      if (!aba) {
        if (mesa.modo === "nomeada") {
          setSeletor({ paraEnviar: false });
          return;
        }
        throw new PedidoRecusado("JMT01", "A mesa foi reaberta. Toque em confirmar de novo.");
      }
      const envio = { session_id: s.session_id, tab_id: aba.id, items: paraOEnvio(sacola.itens) };
      const r = await fonte.enviarPedido(envio, guarda.para(envio));
      guarda.esquecer();
      if (!r.replayed) registrarEvento("order_submitted");
      sacola.esvaziar();
      setRevisando(false);
      setEnviado({ numero: r.display_number, comanda: mesa.modo === "nomeada" ? aba.name : null });
      void mesa.atualizar();
    } catch (e) {
      if (e instanceof TabletNaoPareado) {
        setNaoPareado(e.message);
        return;
      }
      if (e instanceof PedidoRecusado && RECUSAS_DE_MESA.has(e.codigo)) mesa.esquecerMesa();
      else if (e instanceof PedidoRecusado && e.codigo === "JMC01") void mesa.atualizar();
      setErroEnvio(e instanceof PedidoRecusado ? e.message : "O pedido não saiu. Chame o garçom.");
    } finally {
      setEnviando(false);
    }
  }

  const { esvaziar } = sacola;
  const { zerarComanda } = mesa;

  /**
   * Limpeza entre clientes (JM-183): sacola, observações, busca, janelas e comanda ativa
   * voltam ao início, e o pixel ganha sessão nova. A abertura da mesa e a conta **não**
   * são tocadas: só a equipe fecha a conta.
   */
  const limparTela = useCallback(() => {
    esvaziar();
    zerarComanda();
    guarda.esquecer();
    setBusca("");
    setCategoria(null);
    setMenuAberto(false);
    setAberto(null);
    setEditando(null);
    setSacolaAberta(false);
    setRevisando(false);
    setErroEnvio(null);
    setEnviado(null);
    setAdicionado(null);
    setContaAberta(false);
    setSeletor(null);
    setConfirmarNovoCliente(false);
    setColunaMinimizada(false);
    renovarSessao();
    conteudo.current?.scrollTo({ top: 0 });
  }, [esvaziar, zerarComanda, guarda]);

  useInatividade(limparTela, enviando);

  function novoCliente() {
    setMenuAberto(false);
    if (sacola.quantidade > 0) setConfirmarNovoCliente(true);
    else limparTela();
  }

  const destaques = useMemo(
    () => (menu ? menu.products.filter((p) => p.is_featured) : []),
    [menu],
  );

  // Na fonte real a mesa vem do servidor; o parâmetro da URL só vale no exemplo.
  const mesaExibida = mesa.resumo?.table_number ?? menu?.table_number ?? (real ? mesaGuardada : mesaDaUrl);
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
  const envio = fonte.envio;
  const semRede = offline || mesa.semConexao;
  const trocarComanda = useCallback(() => setSeletor({ paraEnviar: false }), []);
  const contextoDaComanda = useMemo(
    () => ({ modo: mesa.modo, ativa: mesa.comandaAtiva, trocar: trocarComanda }),
    [mesa.modo, mesa.comandaAtiva, trocarComanda],
  );
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

  if (recusa) {
    // Tablet sem pareamento válido (JM-181): a mesa em fonte grande e o garçom (JM-187). O
    // chamado funciona com o tablet desativado; com o token recusado, a própria tela manda
    // acenar para a equipe.
    return (
      <GarcomProvider mesa={mesaExibida} chamadoDoResumo={undefined}>
        <main className="jm-kiosk flex h-dvh flex-col items-center justify-center gap-6 p-6 text-center sm:p-10">
          <KioskShell />
          <p className="text-3xl font-bold sm:text-4xl">Chame a equipe</p>
          {mesaExibida !== null ? <p className="text-7xl font-bold tabular-nums">Mesa {mesaExibida}</p> : null}
          <p className="text-muted max-w-xl text-lg sm:text-xl">{recusa}</p>
          <BotaoGarcom grande />
          <a href={`/${loja}/tablet/setup`} className="text-muted text-base underline">
            Parear este tablet
          </a>
        </main>
      </GarcomProvider>
    );
  }

  const botaoNovoCliente = (tom: "primaria" | "claro", className = "") => (
    <button
      type="button"
      onClick={novoCliente}
      className={`jm-touch jm-focus rounded-full px-4 text-base font-semibold ${
        tom === "primaria" ? "text-white/90 hover:bg-white/10" : "bg-canvas"
      } ${className}`}
    >
      Novo cliente
    </button>
  );

  return (
    <GarcomProvider mesa={mesaExibida} chamadoDoResumo={mesa.resumo ? mesa.resumo.waiter_call : undefined}>
      <ComandaProvider value={contextoDaComanda}>
        <div
          className="jm-kiosk flex h-dvh flex-col overflow-hidden min-[640px]:landscape:flex-row"
          // Primeiro toque no cardápio abre a abertura da mesa (JM-182).
          onPointerDownCapture={mesa.tocar}
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

            {colunaMinimizada ? (
              <div className="flex-1" />
            ) : (
              <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Categorias">
                {botoesDeCategoria()}
              </nav>
            )}

            {/* Rodapé da coluna, fora da rolagem: o garçom nunca some (JM-187). */}
            <div className={`grid shrink-0 gap-2 border-t border-white/15 ${colunaMinimizada ? "p-2" : "p-3"}`}>
              <BotaoGarcom tom="primaria" soIcone={colunaMinimizada} className="w-full" />
              {colunaMinimizada ? null : botaoNovoCliente("primaria", "w-full")}
            </div>
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
              <BotaoGarcom tom="primaria" compacto />
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
                  <div className="mt-2 border-t border-white/15 pt-2">{botaoNovoCliente("primaria", "w-full text-left")}</div>
                </nav>
              </>
            ) : null}
          </div>

          {/* Conteúdo */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {semRede ? <OfflineBanner mesa={mesaExibida} acao={<BotaoGarcom tom="primaria" />} /> : null}

            {mesa.contingencia ? (
              <div className="bg-accent px-4 py-3 text-white sm:px-6" role="status">
                <p className="text-base font-semibold">O pedido por esta mesa está pausado agora. O cardápio continua aberto: peça ao garçom.</p>
              </div>
            ) : null}

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
                onClick={() => setContaAberta(true)}
                aria-label={mesa.modo === "nomeada" ? "Minha comanda e conta da mesa" : "Conta da mesa"}
                className="jm-touch jm-focus bg-canvas flex shrink-0 items-center gap-2 rounded-full px-4 text-base font-semibold"
              >
                <IconeConta />
                Conta
              </button>
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

            <FaixaDaComanda />

            <div ref={conteudo} className="flex-1 overflow-y-auto p-4 sm:p-6">
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

          {contaAberta && menu ? (
            <ContaDaMesa
              resumo={mesa.resumo}
              modo={mesa.modo}
              ativa={mesa.comandaAtiva}
              fuso={menu.store.timezone}
              semConexao={semRede}
              onPedirCancelamento={pedirCancelamento}
              onEscolherComanda={trocarComanda}
              onFechar={() => setContaAberta(false)}
            />
          ) : null}

          {revisando ? (
            <OrderReview
              itens={sacola.itens}
              total={sacola.total}
              mesa={mesaExibida}
              envio={envio}
              avisoFechado={avisoFechado}
              offline={semRede}
              contingencia={mesa.contingencia}
              semComanda={mesa.modo === "nomeada" && !mesa.comandaAtiva}
              enviando={enviando}
              erro={erroEnvio}
              onVoltar={voltarDaRevisao}
              onConfirmar={confirmarPedido}
            />
          ) : null}

          {enviado !== null ? (
            <OrderSent
              numero={enviado.numero}
              mesa={mesaExibida}
              comanda={enviado.comanda}
              demonstracao={envio === "demonstracao"}
              onFechar={limparTela}
            />
          ) : null}

          {seletor ? (
            <SeletorDeComanda
              abas={mesa.abas}
              ativa={mesa.comandaAtiva}
              paraEnviar={seletor.paraEnviar}
              onEscolher={aposEscolher}
              onCriar={criarComanda}
              onFechar={() => setSeletor(null)}
            />
          ) : null}

          {confirmarNovoCliente ? (
            <div
              className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 p-4 sm:items-center"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="novo-cliente-titulo"
            >
              <div className="rounded-modal bg-surface shadow-float w-full max-w-sm p-5">
                <p id="novo-cliente-titulo" className="text-xl font-bold">
                  Começar para um novo cliente?
                </p>
                <p className="mt-2 text-base">A sacola tem {rotuloDeItens(sacola.quantidade)} que ainda não foram enviados, e ela será esvaziada.</p>
                <p className="text-muted mt-2 text-sm">Os pedidos já enviados continuam na conta da mesa.</p>
                <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setConfirmarNovoCliente(false)}
                    className="jm-touch jm-focus bg-surface border-line rounded-full border-2 px-5 text-base font-semibold"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={limparTela}
                    className="jm-touch jm-focus bg-primary rounded-full px-5 text-base font-bold text-white sm:flex-1"
                  >
                    Esvaziar e começar
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </ComandaProvider>
    </GarcomProvider>
  );
}
