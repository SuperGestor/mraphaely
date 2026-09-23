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
