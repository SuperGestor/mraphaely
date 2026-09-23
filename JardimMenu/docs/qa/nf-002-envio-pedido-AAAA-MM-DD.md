# Medição do NF-002 — resposta do envio do pedido — AAAA-MM-DD

> **Este arquivo é um modelo.** Copie-o com a data do dia no nome
> (`nf-002-envio-pedido-2026-11-12.md`), preencha enquanto mede e apague estas
> linhas entre `>`.

**O requisito (NF-002):** feedback visual em até 100 ms; p95 da resposta do
servidor abaixo de 500 ms em 20 execuções, no Wi-Fi do salão.

**Fase B.** Na Fase A `/api/orders` não existe e responde 404 (regra 1 do
`CLAUDE.md`): até a Fase B não há o que medir aqui, e um registro desta medição
datado da Fase A só pode significar que alguém mediu outra coisa.

---

## 0. Antes de medir: são dois números, e eles medem coisas diferentes

> Este é o ponto onde a medição do NF-002 costuma sair errada. Os dois números
> não se substituem, e o bom resultado de um esconde o problema do outro.

| Número | O que é | Limite | Como se obtém |
|---|---|---|---|
| **Feedback visual** | Do toque em "Enviar pedido" até a tela **mudar** — botão desabilita, aparece o "enviando" | 100 ms | Vídeo a 60 fps, contando quadros |
| **Resposta do servidor** | Do início da requisição `POST /api/orders` até o fim da resposta | p95 < 500 ms em 20 execuções | Relógio do navegador |

O feedback visual **não espera o servidor**: ele é a tela reagindo ao toque. Se
o front só muda a tela quando a resposta chega, o feedback visual passa a valer
o que valer a rede, e nesse dia o NF-002 falha em rede ruim mesmo com servidor
rápido. É esse o defeito que a medição de 100 ms existe para pegar.

> **Rápido e errado não passa.** Resposta em 80 ms que confirma pedido sem o
> servidor ter gravado nada é violação do JM-035 e do JM-185, não aprovação do
> NF-002. A seção 6 confere isso.

## 1. O aparelho e a rede

> Mesma exigência do NF-001: sem isto preenchido o número descreve um aparelho
> e uma rede que ninguém mais sabe quais eram.

| Campo | Valor |
|---|---|
| Modelo do tablet | |
| Versão do Android | |
| Navegador e versão | |
| É o modelo que a casa vai comprar (NF-017)? | ( ) sim  ( ) não — e então o número é referência, não aceite |
| Resolução e orientação | 1280×800, paisagem (alvo de medição, P10) |
| Rede | ( ) Wi-Fi do salão  ( ) outra: ____ |
| SSID | |
| Mesa onde foi medido | |
| Sinal naquela mesa | ____ dBm (ou: barras) |
| Bateria | ____% · ( ) na tomada  ( ) só bateria |

> Meça na **pior mesa** que estiver em uso, não na mesa ao lado do roteador. O
> NF-002 é o requisito que mais sente a rede do salão, porque cada envio é uma
> ida e volta completa.

## 2. O que está sendo medido

| Campo | Valor |
|---|---|
| Ambiente | ( ) staging  ( ) produção |
| Endereço | |
| Versão do app (commit) | |
| Versão do banco (última migração) | |
| Mesa e dispositivo pareado | |
| Quantos itens por pedido | (o padrão da série é 3; veja a seção 3) |
| Quantos complementos por item | |

### Onde medir, e o preço disso

> **Cada execução cria um pedido de verdade no banco.** São 20 pedidos. Isso
> não é efeito colateral da medição: é a medição.

- [ ] **Medi em staging.** É o caminho normal, e é o que o NF-012 quer. O
      staging precisa estar **no Wi-Fi do salão** e no tablet de verdade, senão
      volta a medir outra coisa.
- [ ] **Medi em produção.** Então responda, aqui, as três perguntas:
  - A casa estava fechada? `__________`
  - Os 20 pedidos foram cancelados depois, pela equipe? `__________`
  - Os números sequenciais do turno (JM-036) foram consumidos — a casa sabe
    disso? `__________`

> Se medir em produção com a casa aberta, os 20 pedidos caem na tela da equipe
> no meio do serviço. Não faça isso sem combinar antes com quem está no salão.

## 3. Como medir

### Preparo

1. Tablet no Wi-Fi do salão, na mesa escolhida, **em pé no suporte**.
2. Cabo USB até um notebook, depuração USB ligada, Chrome em `chrome://inspect`
   → **inspect** na aba do cardápio. O cabo carrega só a depuração; a
   requisição continua passando pelo Wi-Fi do salão.
3. Aparelho **quente**, como no NF-001: é o estado real de operação.
4. Abra uma comanda na mesa e deixe a sacola pronta com **3 itens, um deles com
   complemento**. Pedido de um item só mede menos trabalho do servidor do que
   o pedido real; o preço sai todo do banco (JM-031), e o custo acompanha a
   quantidade de item e de complemento.
5. **Não rode a limpeza de sessão (JM-183) no meio da série**: ela renova a
   sessão e zera a comanda, e a série perde a comparação.

### A armadilha do `Idempotency-Key`

> Leia isto antes de medir, ou a série inteira vai para o lixo.

Toda criação de pedido exige o header `Idempotency-Key`, único **por abertura de
mesa** (JM-032). Repetir a chave **não cria pedido**: devolve o pedido que já
existe. Essa resposta repetida é muito mais rápida que a criação de verdade,
porque o servidor não calcula preço nem grava nada.

Consequência prática: **cada uma das 20 execuções precisa de uma chave nova**, e
é o front que gera. O jeito honesto de medir é **usar o botão**, tocando em
"Enviar pedido" como o cliente toca, e conferir na seção 4 que os 20 pedidos têm
ids diferentes. Se dois ids se repetirem, aquela execução mediu a resposta
repetida e não conta.

> A resposta repetida também merece ser medida, mas **separada**, na seção 5.
> Ela é o caminho do toque duplo, e é bom saber que é rápida — ela só não pode
> entrar na conta do p95.

### O laço das 20 execuções

Cole no console do DevTools remoto **uma vez**, logo depois de abrir a tela do
cardápio. Ele passa a escutar os envios e acumula sozinho:

```js
// NF-002 — acompanhar a resposta de POST /api/orders. Cole uma vez e depois
// use o botão "Enviar pedido" normalmente, 20 vezes.
(() => {
  const CHAVE = 'medicao-nf-002';
  const ALVO = 20;
  if (window.__nf002) { console.warn('já estava escutando'); return; }
  window.__nf002 = true;

  const original = window.fetch;
  window.fetch = async function (...args) {
    const req = new Request(...args);
    const eDePedido = req.method === 'POST' && new URL(req.url, location.href).pathname === '/api/orders';
    if (!eDePedido) return original.apply(this, args);

    const t0 = performance.now();
    const resposta = await original.apply(this, args);
    const ms = Math.round(performance.now() - t0);

    // O corpo é lido de um clone, para não consumir o que o app vai ler.
    let id = null, numero = null, repetido = null;
    try {
      const corpo = await resposta.clone().json();
      id = corpo?.id ?? corpo?.order?.id ?? null;
      numero = corpo?.order_number ?? corpo?.order?.order_number ?? null;
      repetido = resposta.headers.get('Idempotent-Replay');
    } catch { /* resposta sem JSON: fica registrado só o tempo e o status */ }

    const serie = JSON.parse(sessionStorage.getItem(CHAVE) || '[]');
    const medicao = {
      n: serie.length + 1,
      ms,
      status: resposta.status,
      id,
      numero,
      repetido,
      chave: req.headers.get('Idempotency-Key'),
    };
    serie.push(medicao);
    sessionStorage.setItem(CHAVE, JSON.stringify(serie));
    console.log(`envio ${serie.length}/${ALVO}`, medicao);

    if (serie.length >= ALVO) {
      const ok = serie.filter((m) => m.status >= 200 && m.status < 300);
      const ids = new Set(ok.map((m) => m.id).filter(Boolean));
      // Ordem de posto: com 20 medições, o p95 é a 19ª em ordem crescente.
      const p = (q) => {
        const v = ok.map((m) => m.ms).sort((a, b) => a - b);
        return v.length ? v[Math.ceil(q * v.length) - 1] : null;
      };
      console.table(serie);
      console.log('--- resumo (ms) ---');
      console.table({
        resposta: { minimo: p(0.001), mediana: p(0.5), p95: p(0.95), maximo: p(1) },
      });
      console.log(`pedidos com id distinto: ${ids.size} de ${ok.length} respostas boas`);
      if (ids.size < ok.length) console.warn('há id repetido: alguma execução caiu na resposta idempotente e NÃO conta');
      console.log('NF-002 (p95 < 500 ms):', p(0.95) < 500 ? 'PASSOU' : 'NÃO PASSOU');
    }
    return resposta;
  };
  console.log('escutando. Envie o pedido pelo botão, 20 vezes.');
})();
```

Para começar uma série nova: `sessionStorage.removeItem('medicao-nf-002')` e
recarregue a página (a recarga desfaz o gancho no `fetch`).

> O gancho mede **a ida e volta inteira vista pelo tablet**, que é o que o
> cliente espera: fila do navegador, rede do salão, trabalho do servidor e
> volta. É esse o número do requisito. Para saber **onde** o tempo foi, use a
> aba Rede do DevTools: ela separa o tempo de espera do servidor do tempo de
> transferência, e é isso que diz se o culpado é o banco ou o Wi-Fi.

### O feedback visual de 100 ms

O relógio do JavaScript não serve aqui: ele diz quando o código rodou, não
quando o **pixel mudou**. Grave a tela do tablet, ou filme com outro celular a
60 fps, e conte os quadros entre:

- o quadro em que o dedo encosta no botão "Enviar pedido";
- o primeiro quadro em que **alguma coisa** mudou na tela.

A 60 fps, cada quadro vale ~16,7 ms: **100 ms são 6 quadros**. Três repetições
bastam. Se o primeiro quadro diferente só aparece quando a resposta chega, o
feedback visual falhou, por mais rápido que o servidor esteja.

## 4. Resultado — resposta do servidor

| # | ms | status | id do pedido | nº do pedido |
|---:|---:|---:|---|---:|
| 1 | | | | |
| … | | | | |
| 20 | | | | |

| Resumo | ms |
|---|---:|
| Mínimo | |
| Mediana | |
| **p95** | |
| Máximo | |

| Conferência | Valor |
|---|---|
| Ids distintos entre as respostas boas | ____ de ____ |
| Quantas respostas não foram 2xx | ____ · quais e por quê: |

**p95 abaixo de 500 ms?** ( ) sim, passou  ( ) não passou

**Os 20 pedidos são 20 pedidos distintos?** ( ) sim  ( ) não — e então a série
não vale, veja a armadilha do `Idempotency-Key` na seção 3

## 5. Resultado — feedback visual

| Repetição | Quadros até a tela mudar | ms | O que mudou na tela |
|---:|---:|---:|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |

**Até 100 ms (6 quadros a 60 fps)?** ( ) sim, passou  ( ) não passou

### Toque duplo (o caminho idempotente, medido à parte)

> Isto não entra no p95. Está aqui porque é o que acontece de verdade no salão:
> o cliente toca duas vezes.

| Repetição | 1º envio (ms) | 2º envio (ms) | Criou 1 pedido só? |
|---:|---:|---:|---|
| 1 | | | ( ) sim ( ) não |
| 2 | | | ( ) sim ( ) não |

## 6. Conferência: a resposta rápida está dizendo a verdade?

> Medir tempo sem conferir conteúdo aprova um sistema que responde depressa e
> perde pedido. Confira com as mãos, depois da série:

- [ ] Os 20 pedidos aparecem na **tela da equipe** (JM-121).
- [ ] O total de um pedido conferido à mão bate com o preço do cardápio, com
      complementos (JM-031: o preço é do servidor).
- [ ] Os números sequenciais do turno não se repetiram (JM-036).
- [ ] Todos nasceram em `confirmed` (JM-034).
- [ ] **Com o Wi-Fi desligado**, o envio é recusado e **nenhuma confirmação
      falsa** aparece (JM-035, JM-185). O botão de chamar o garçom continua
      funcionando (JM-187).

## 7. Leitura do resultado

- [ ] **Passou.** p95 abaixo de 500 ms e feedback visual dentro de 100 ms, no
      aparelho e na rede de verdade.
- [ ] **Passou apertado** (p95 entre 400 ms e 500 ms). Anote o que pesa: com a
      casa cheia e mais mesas enviando junto, isso vira reprovação sozinho.
- [ ] **Não passou.** O que estava mais lento:
  - [ ] o servidor (a espera do servidor domina o tempo na aba Rede)
  - [ ] o banco (o cálculo de preço e a gravação do pedido)
  - [ ] a rede do salão naquela mesa (NF-019)
  - [ ] o front, que só reage quando a resposta chega (falha de feedback visual)
  - [ ] o aparelho (e aí a conversa é com o NF-017)
- [ ] **Não medido no aparelho real, ou fora do Wi-Fi do salão.** Então isto
      **não é aceite**: é referência, e a pendência continua aberta.

> Vale registrar se a medição foi feita com o salão vazio. Uma mesa enviando
> sozinha às 15h não descreve sábado à noite com onze mesas. Se der para medir
> com mais gente, meça, e diga aqui quantas mesas estavam ativas.

| Campo | Valor |
|---|---|
| Quantas mesas ativas durante a série | |
| Horário da medição | |

## 8. O que fazer a respeito

> Uma linha por ação, com dono e prazo.

- [ ] `__________`

## 9. Quem mediu

| Campo | Valor |
|---|---|
| Data | AAAA-MM-DD |
| Quem mediu | |
| Quem conferiu | |
| Quem cancelou os pedidos de teste | |
| Duração da sessão de medição | |
