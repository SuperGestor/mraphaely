# Aparelho de teste — 2026-09-24 — **não é o aparelho de aceite**

Existe um tablet para testar: um **Galaxy Tab A11**. A casa **ainda vai escolher**
o modelo que vai comprar.

Isso muda o que as medições valem, e o registro precisa dizer isso antes de
alguém citar um número fora de contexto.

## O que este aparelho serve para fazer

- **Achar defeito de verdade**: tela que não cabe, toque que não responde, fonte
  pequena demais, teclado que cobre o campo, orientação que gira sozinha. Nada
  disso aparece em emulador com a mesma honestidade.
- **Primeira medição do NF-001** (cardápio interativo em menos de 2 s), como
  referência.
- **Provar o modo kiosk** (NF-018) e o pareamento no próprio aparelho (JM-180).

## O que ele NÃO fecha

O **NF-017** pede que a medição de aceite seja feita no modelo que a casa vai
usar. Enquanto o modelo definitivo não existir, todo número medido aqui entra
como **referência**, e a medição se repete quando o aparelho chegar.

## Decisão de 24/09/2026 sobre quando medir

O dono do produto escolheu **medir no salão**, e não aqui. O motivo é bom: o
NF-001 e o NF-002 são os requisitos que mais sentem a rede, e medir na mesa de
trabalho, no Wi-Fi de casa, produz um número que não descreve o serviço. A
medição acontece quando o tablet estiver na casa, na pior mesa em uso.

## O que já está pronto para esse dia

| O quê | Onde |
|---|---|
| Roteiro do NF-001, 20 recargas por depuração remota | `front/scripts/medir-nf001.mjs` |
| Bancada do NF-002, 20 envios de pedido | `front/scripts/medir-nf002.mjs` |
| Como rodar as duas | `docs/qa/README.md` |
| Modelos de registro | `docs/qa/nf-001-cardapio-AAAA-MM-DD.md` e `nf-002-envio-pedido-AAAA-MM-DD.md` |

Falta, no dia: ligar as opções do desenvolvedor e a depuração USB no tablet,
ter o `adb` na máquina que vai medir, e filmar o toque a 60 fps para o feedback
visual de 100 ms do NF-002 — esse não tem relógio de JavaScript que meça.

## Pendências que este aparelho não resolve

- **A12** segue aberta: modelo e quantidade que a casa vai comprar.
- **A13** sai da A12.
- **A14**, tomada nas mesas, continua sem resposta e decide se o tablet passa o
  turno na tomada ou na bateria — o que muda o brilho de tela que dá para usar.
