/**
 * Estados obrigatórios de toda tela (prompt 1): carregando com esqueleto, vazio com
 * texto útil, erro com ação de repetir, e sem conexão.
 */

export function SkeletonCard() {
  return (
    <div className="rounded-card bg-surface shadow-card overflow-hidden" aria-hidden="true">
      <div className="jm-skeleton h-32 w-full" />
      <div className="space-y-3 p-4">
        <div className="jm-skeleton h-5 w-3/4 rounded" />
        <div className="jm-skeleton h-4 w-full rounded" />
        <div className="jm-skeleton h-4 w-2/3 rounded" />
        <div className="jm-skeleton h-6 w-24 rounded" />
      </div>
    </div>
  );
}

export function SkeletonGrid({ cards = 6 }: { cards?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 sm:gap-5 min-[1200px]:grid-cols-3 min-[1680px]:grid-cols-4"
      role="status"
      aria-label="Carregando o cardápio"
    >
      {Array.from({ length: cards }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function EmptyState({
  titulo,
  texto,
  acao,
}: {
  titulo: string;
  texto: string;
  acao?: { rotulo: string; onClick: () => void };
}) {
  return (
    <div className="rounded-card bg-surface shadow-card mx-auto max-w-md p-10 text-center">
      <p className="text-xl font-semibold">{titulo}</p>
      <p className="text-muted mt-2 text-base">{texto}</p>
      {acao ? (
        <button
          type="button"
          onClick={acao.onClick}
          className="jm-touch jm-focus bg-primary mt-6 rounded-full px-6 text-base font-semibold text-white"
        >
          {acao.rotulo}
        </button>
      ) : null}
    </div>
  );
}

export function ErrorState({ onRepetir }: { onRepetir: () => void }) {
  return (
    <div
      className="rounded-card bg-surface shadow-card mx-auto max-w-md p-10 text-center"
      role="alert"
    >
      <p className="text-xl font-semibold">O cardápio não carregou</p>
      <p className="text-muted mt-2 text-base">
        Pode ter sido a rede da casa. Toque em tentar de novo.
      </p>
      <button
        type="button"
        onClick={onRepetir}
        className="jm-touch jm-focus bg-primary mt-6 rounded-full px-6 text-base font-semibold text-white"
      >
        Tentar de novo
      </button>
    </div>
  );
}

/**
 * Sem conexão (JM-185, JM-012): nenhum pedido sai, e a faixa manda chamar o garçom com o
 * número da mesa em fonte grande, para o cliente chamar com a voz. O botão de garçom da
 * tela continua visível (JM-187), e `acao` o repete aqui quando a tela o fornece.
 */
export function OfflineBanner({ mesa, acao }: { mesa: number | null; acao?: React.ReactNode }) {
  return (
    <div
      className="bg-danger flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 text-white sm:px-6"
      role="status"
    >
      <p className="min-w-0 flex-1 text-base font-semibold sm:text-lg">
        Sem conexão, chame o garçom. O cardápio continua navegável, mas nenhum pedido sai.
      </p>
      {mesa !== null ? <p className="text-4xl leading-none font-bold tabular-nums sm:text-5xl">Mesa {mesa}</p> : null}
      {acao}
    </div>
  );
}
