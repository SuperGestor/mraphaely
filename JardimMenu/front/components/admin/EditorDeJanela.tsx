"use client";

import { useState } from "react";
import type { TimeWindow } from "@/lib/types";
import {
  ATALHOS,
  DIAS_DA_SEMANA,
  MAXIMO_DE_FAIXAS,
  cruzaAMeiaNoite,
  faixasDoAtalho,
  novaFaixa,
  problemasDaJanela,
  type Atalho,
} from "@/lib/janela-do-produto";
import { Button, Hint, Switch, TextInput } from "@/components/admin/ui";

/**
 * Editor do horário do produto (JM-006, "almoço x jantar"): ou o produto é sempre
 * disponível (janela nula), ou aparece só nas faixas da lista, cada uma com dia da semana,
 * abertura e fechamento, no mesmo formato `TimeWindow` do horário da loja (JM-005).
 *
 * O editor só MONTA faixas, em hora local da loja. Quem decide se o produto aparece agora
 * é o banco, com `jm_windows_open` no fuso da loja (regra 5 do CLAUDE.md, D12): aqui não
 * há conta de fuso, de "hoje" nem de "agora". As regras de conforto estão em
 * lib/janela-do-produto.ts; a validação de verdade é do banco (`jm_windows_valid`), e a
 * recusa dele, se vier, aparece no formulário do produto, junto do botão de salvar.
 *
 * Mesmo padrão visual da tela de horário da loja (interruptor, seletor, campo de hora),
 * mas em cartões empilhados em vez de tabela: no celular, a tabela rolaria na horizontal
 * no meio de um formulário comprido.
 */

const SELECT = "rounded-input border-line bg-canvas jm-touch jm-focus w-full border-2 px-4 text-base";

export function EditorDeJanela({
  valor,
  onChange,
}: {
  valor: TimeWindow[] | null;
  onChange: (valor: TimeWindow[] | null) => void;
}) {
  // Faixas guardadas quando o gestor desliga o horário próprio: religar devolve o que ele
  // montou, em vez de começar do zero por um toque errado.
  const [guardadas, setGuardadas] = useState<TimeWindow[]>(valor ?? []);
  // Lista de antes do atalho, que substitui tudo: um toque desfaz. Some na próxima edição.
  const [antesDoAtalho, setAntesDoAtalho] = useState<TimeWindow[] | null>(null);

  const restrito = valor !== null;
  const faixas = valor ?? [];
  const problemas = problemasDaJanela(valor);
  const cheio = faixas.length >= MAXIMO_DE_FAIXAS;

  function mudarLista(lista: TimeWindow[] | null) {
    setAntesDoAtalho(null);
    onChange(lista);
  }

  function alternar(ligar: boolean) {
    if (ligar) {
      mudarLista(guardadas);
    } else {
      setGuardadas(faixas);
      mudarLista(null);
    }
  }

  function mudarFaixa(i: number, mudanca: Partial<TimeWindow>) {
    mudarLista(faixas.map((f, j) => (j === i ? { ...f, ...mudanca } : f)));
  }

  function aplicarAtalho(atalho: Atalho) {
    const anterior = faixas;
    onChange(faixasDoAtalho(atalho));
    setAntesDoAtalho(anterior.length ? anterior : null);
  }

  return (
    <fieldset className="mb-6 min-w-0">
      <legend className="text-base font-semibold">Horário do produto</legend>
      <p className="text-muted mt-1 text-sm">
        Fora das faixas, o produto não aparece no cardápio do tablet. As horas são as da loja, e quem confere o
        relógio é o servidor, no fuso dela.
      </p>

      <div className="mt-3 flex items-center gap-3">
        <Switch ligado={restrito} onChange={alternar} rotulo="Produto com horário próprio" />
        <span className="text-base">
          {restrito
            ? "Aparece só nas faixas abaixo"
            : "Sempre disponível: aparece a qualquer hora, e o pedido segue só o horário da loja"}
        </span>
      </div>

      {restrito ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted text-sm">Atalhos, para os sete dias:</span>
            {(Object.keys(ATALHOS) as Atalho[]).map((atalho) => (
              <Button key={atalho} variante="secundario" onClick={() => aplicarAtalho(atalho)}>
                {ATALHOS[atalho].rotulo} {ATALHOS[atalho].open}–{ATALHOS[atalho].close}
              </Button>
            ))}
            {antesDoAtalho ? (
              <Button variante="secundario" onClick={() => mudarLista(antesDoAtalho)}>
                Desfazer atalho
              </Button>
            ) : null}
          </div>

          {faixas.length === 0 ? (
            <div className="mt-4">
              <Hint>
                Nenhuma faixa ainda. Use um atalho ou adicione uma faixa. Sem faixa o produto não apareceria em horário
                nenhum, então a gravação fica bloqueada até haver uma.
              </Hint>
            </div>
          ) : (
            <ol className="mt-4 flex flex-col gap-3">
              {faixas.map((faixa, i) => {
                const problema = problemas.faixas[i];
                const nome = DIAS_DA_SEMANA[faixa.dow] ?? "dia inválido";
                return (
                  <li key={i} className="border-line rounded-input border-2 p-3 sm:p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">Faixa {i + 1}</span>
                      <Button
                        variante="secundario"
                        onClick={() => mudarLista(faixas.filter((_, j) => j !== i))}
                        aria-label={`Remover faixa ${i + 1}: ${nome}, ${faixa.open} às ${faixa.close}`}
                      >
                        Remover
                      </Button>
                    </div>
                    {/* minmax(0, 1fr): no celular estreito o campo de hora encolhe em vez de
                        empurrar o cartão para fora da tela. */}
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem]">
                      {/* Nomes com o número da faixa: com várias faixas, "Dia" sozinho não diz
                          ao leitor de tela qual delas ele está mudando. */}
                      <label className="col-span-2 block sm:col-span-1">
                        <span className="text-muted mb-1 block text-sm">Dia</span>
                        <select
                          className={SELECT}
                          value={faixa.dow}
                          aria-label={`Dia da faixa ${i + 1}`}
                          onChange={(e) => mudarFaixa(i, { dow: Number(e.target.value) })}
                        >
                          {DIAS_DA_SEMANA.map((dia, dow) => (
                            <option key={dia} value={dow}>
                              {dia}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-muted mb-1 block text-sm">Abre</span>
                        <TextInput
                          type="time"
                          value={faixa.open}
                          aria-label={`Abertura da faixa ${i + 1}`}
                          onChange={(e) => mudarFaixa(i, { open: e.target.value })}
                        />
                      </label>
                      <label className="block">
                        <span className="text-muted mb-1 block text-sm">Fecha</span>
                        <TextInput
                          type="time"
                          value={faixa.close}
                          aria-label={`Fechamento da faixa ${i + 1}`}
                          onChange={(e) => mudarFaixa(i, { close: e.target.value })}
                        />
                      </label>
                    </div>
                    {cruzaAMeiaNoite(faixa) ? (
                      <p className="text-muted mt-2 text-sm">Fecha no dia seguinte, às {faixa.close}.</p>
                    ) : null}
                    {/* Sem role="alert": o campo de hora fica vazio enquanto o gestor digita, e
                        o leitor de tela anunciaria a cada tecla. O aviso que é anunciado é o
                        do botão de salvar, na página. */}
                    {problema ? <p className="text-danger mt-2 text-sm font-semibold">{problema}</p> : null}
                  </li>
                );
              })}
            </ol>
          )}

          {problemas.geral && faixas.length > 0 ? (
            <p className="text-danger mt-3 text-sm font-semibold">{problemas.geral}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variante="secundario" onClick={() => mudarLista([...faixas, novaFaixa(faixas)])} disabled={cheio}>
              Adicionar faixa
            </Button>
            <span className="text-muted text-sm">
              {faixas.length} de {MAXIMO_DE_FAIXAS} faixas
              {cheio ? ": para outra, remova uma" : ""}
            </span>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}
