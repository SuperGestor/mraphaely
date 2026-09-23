# docs/qa: os registros de prova

Esta pasta guarda **o que foi medido e verificado**, com data. Ela não é
documentação do produto: é a memória do que aconteceu, e é dela que sai a
resposta quando alguém pergunta "isso foi testado?".

A regra do projeto é curta: *nunca afirme que algo funciona sem ter rodado*.
Um registro aqui é o "ter rodado" escrito.

## Os modelos

| Modelo | Para que serve | Requisito |
|---|---|---|
| `restauracao-AAAA-MM-DD.md` | Restauração completa do backup, executada e conferida | NF-011 |
| `nf-001-cardapio-AAAA-MM-DD.md` | Cardápio interativo em menos de 2 s, no tablet de verdade | NF-001 |
| `nf-002-envio-pedido-AAAA-MM-DD.md` | Resposta do envio do pedido | NF-002 |

## Como usar

1. Copie o modelo trocando `AAAA-MM-DD` pela data do dia, em números:
   `restauracao-2026-09-30.md`. (Os requisitos escrevem esse nome como
   `restauracao-YYYY-MM-DD.md`; é o mesmo formato, ano-mês-dia.)
2. Preencha **enquanto** executa, não depois. Registro escrito de memória, no
   dia seguinte, erra justamente no detalhe que importa.
3. Não apague campo que não se aplica: escreva *"não se aplica"* e o porquê. O
   campo em branco é ambíguo — ninguém sabe se foi pulado ou esquecido.
4. Deu errado? **Registre assim mesmo.** A medição que falhou é a mais útil que
   existe, e apagá-la é o único jeito garantido de repetir o erro.
5. Commit em português, junto com o resto do trabalho.

## Como rodar as duas medições

Os dois scripts vivem em `JardimMenu/front/scripts/` e se rodam de
`JardimMenu/front`. **Tudo entra por variável de ambiente**, nunca por argumento
de linha de comando: o token do tablet é segredo (NF-006), e argumento aparece na
lista de processos e no histórico do shell. O passo a passo completo, com como
descobrir cada valor, está no comentário no começo de cada script — o que segue
aqui é o resumo.

| Medição | Comando | O que mede | O que **não** mede |
|---|---|---|---|
| NF-001 | `npm run medir:nf001` | Tempo até o primeiro card de produto estar visível e clicável, 20 recargas, no Chrome do tablet por depuração remota | O tempo da foto (é impresso, mas não decide) |
| NF-002 | `npm run medir:nf002` | Resposta de `POST /api/orders`, 20 pedidos, cada um com `Idempotency-Key` nova | O feedback visual de 100 ms, que se mede filmando a tela |

```sh
# NF-001 — com o tablet ligado por USB, depuração ligada e a ponte aberta:
adb forward tcp:9222 localabstract:chrome_devtools_remote
NF001_URL=https://servidor-do-salao/jardim-secreto/tablet npm run medir:nf001

# NF-002 — em staging, ou em mesa de teste com a casa fechada:
read -rs JM_TOKEN && export JM_TOKEN     # não ecoa e não vai para o histórico
export JM_URL=https://staging-do-salao
export JM_SESSION=... JM_TAB=... JM_PRODUTO=...
npm run medir:nf002
```

Saída dos dois: `0` passou, `1` reprovou ou a série não vale, `2` a entrada está
errada (falta variável, token com formato inválido, aparelho que não é o tablet).

### Três coisas que costumam passar batido

1. **O NF-002 cria 20 pedidos de verdade**, com número de turno consumido
   (JM-036), e eles aparecem na tela da equipe. O script lista os pedidos
   criados no fim; **a equipe precisa cancelar todos**, e o registro tem campo
   para dizer quem cancelou.
2. **O `medir-nf002.mjs` é bancada de servidor**, rodada do computador. Ele
   responde "o servidor cabe no orçamento de 500 ms?". Quem responde "o cliente
   sente imediato?" é a medição no tablet, com o gancho de `fetch` que está no
   modelo de registro, mais o vídeo a 60 fps do feedback visual. Uma não
   substitui a outra, e o NF-002 só é aceite com as duas.
3. **O `medir-nf001.mjs` recusa rodar fora do tablet.** Em emulador ou desktop
   ele só roda com `NF001_PERMITIR_NAO_ANDROID=1`, e aí marca a rodada como
   ensaio, que não vale como aceite (§6).

### O que registrar, e onde

1. Copie o modelo da medição com a data do dia no nome
   (`nf-002-envio-pedido-2026-11-12.md`).
2. **Cole a saída inteira do script**, da primeira linha à última, e não só o
   p95. O que explica um p95 ruim são as execuções, não o resumo.
3. Preencha o aparelho, a rede, a mesa e o ambiente. Número sem aparelho e sem
   rede não descreve nada, e por isso não é aceite.
4. Complete à mão o que o script não mede: o tempo da foto e a leitura do
   resultado no NF-001; o feedback visual, o toque duplo e a conferência de que
   os pedidos chegaram certos, no NF-002.
5. Commit em português, com o registro junto.

## O que ainda vai morar aqui

- `incidentes.md`, o canal de registro de incidente do piloto (§18.3).
- As rodadas exploratórias, uma por rodada (§9.3).

## Um aviso sobre medição

NF-001 e NF-002 se medem **no tablet que a casa vai usar, no Wi-Fi do salão**.
Tablet de entrada é bem mais lento que celular recente, e medir em notebook dá
um número bonito que não descreve nada.

Se o tablet ainda não existe, o registro é escrito assim mesmo, com o resultado
do emulador e a frase **"medição de NF-001 pendente: sem aparelho real"** em
destaque. Isso é uma pendência declarada, não um aceite.
