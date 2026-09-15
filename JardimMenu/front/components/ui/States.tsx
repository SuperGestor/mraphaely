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
 * Sem conexão. Na Fase B esta faixa ganha o número da mesa em fonte grande e o botão
 * de chamar o garçom (JM-185, JM-187). Na Fase A ela só avisa.
 */
export function OfflineBanner({ mesa }: { mesa: number | null }) {
  return (
    <div
      className="bg-danger flex items-center justify-between gap-4 px-6 py-3 text-white"
      role="status"
    >
      <p className="text-base font-semibold">
        Sem conexão. O cardápio continua navegável.
      </p>
      {mesa !== null ? <p className="text-2xl font-bold tabular-nums">Mesa {mesa}</p> : null}
    </div>
  );
}
