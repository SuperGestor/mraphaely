# Medição do NF-001 — cardápio interativo em menos de 2 s — AAAA-MM-DD

> **Este arquivo é um modelo.** Copie-o com a data do dia no nome
> (`nf-001-cardapio-2026-10-05.md`), preencha enquanto mede e apague estas
> linhas entre `>`.

**O requisito (NF-001):** p95 abaixo de 2 s **no tablet real que a casa vai
usar**, no Wi-Fi do salão, 20 execuções, sobre o cardápio de verdade com as
fotos de verdade. Tablet de entrada é mais lento que celular recente: medir em
desktop não vale.

---

## 0. Antes de medir: o que conta como "interativo"

> O requisito não diz qual instante marca o fim da contagem, e essa escolha
> muda o número. Registre a definição usada; se for a primeira medição do
> projeto, **confirme com o PO** antes de tratar o resultado como aceite.

Definição proposta, e usada neste registro salvo indicação em contrário:

> O cardápio está interativo quando **a grade de produtos da primeira
> categoria está desenhada, com as fotos visíveis, e um toque em um produto
> abre o detalhe**. O relógio começa no início da navegação.

Na prática são duas medidas, e as duas entram aqui:

| Medida | Como se obtém | Por que ela |
|---|---|---|
| **LCP** (maior conteúdo pintado) | Automática, pelo navegador | É o instante em que a tela "virou cardápio" para quem está olhando |
| **Primeiro toque responde** | Cronometrada em vídeo | É o "interativo" do requisito. Tela pintada que não responde a toque não é cardápio pronto |

O número que vai para o aceite é o **p95 do LCP**, com o "primeiro toque
responde" como conferência de que a tela pintada não estava travada.

## 1. O aparelho e a rede

> Sem isso preenchido, o número não quer dizer nada: ele descreve um aparelho
> e uma rede que ninguém mais sabe quais eram.

| Campo | Valor |
|---|---|
| Modelo do tablet | |
| Versão do Android | |
| Memória RAM | |
| Navegador e versão | |
| É o modelo que a casa vai comprar (NF-017)? | ( ) sim  ( ) não — e então o número é referência, não aceite |
| Resolução e orientação | 1280×800, paisagem (alvo de medição, P10) |
| Brilho | ( ) automático  ( ) fixo em ____% |
| Bateria | ____% · ( ) na tomada  ( ) só bateria |
| Rede | ( ) Wi-Fi do salão  ( ) outra: ____ |
| SSID | |
| Mesa onde foi medido | |
| Sinal naquela mesa | ____ dBm (ou: barras) |

> A mesa importa. O NF-019 pede cobertura medida em **todas** as mesas: se a
> medição do NF-001 for feita só na mesa ao lado do roteador, ela mede o
> roteador, não o salão. Meça na melhor e na pior mesa, e registre as duas.

## 2. O que está sendo medido

| Campo | Valor |
|---|---|
| Ambiente | ( ) produção  ( ) staging |
| Endereço | |
| Versão do app (commit) | |
| Cardápio | ( ) o real do Jardim Secreto  ( ) de exemplo — e então **não vale como aceite** |
| Quantos produtos | |
| Quantas categorias | |
| Fotos | ( ) as de verdade  ( ) de exemplo |

### Peso das fotos servidas (§18.4)

> O NF-001 depende quase todo disto. O que conta é o que é **servido**, não o
> que foi enviado no upload. Veja na aba Rede do DevTools, com o cardápio
> aberto.

| Uso | Teto | Maior encontrada |
|---|---|---|
| Card da grade (400px) | 45 KB em WebP | |
| Card da vitrine (600px) | 70 KB | |
| Foto do modal (900px) | 120 KB | |
| **Peso total da primeira tela** | — | |

## 3. Como medir

### Preparo

1. Tablet no Wi-Fi do salão, na mesa escolhida, **em pé no suporte**, como o
   cliente vai usar.
2. Cabo USB até um notebook, com depuração USB ligada. O cabo carrega só a
   depuração; a página continua passando pelo Wi-Fi do salão.
3. No notebook, Chrome em `chrome://inspect` → **inspect** na aba do cardápio.
4. Deixe o aparelho **quente**: é o estado real de operação (o tablet fica
   ligado o dia inteiro, e a limpeza entre clientes não recarrega o sistema).
   Se você também medir com cache vazio, registre as duas séries separadas.

### O laço das 20 execuções

Cole no console do DevTools remoto, **uma vez por carga**. Ele acumula as
medições entre recargas e imprime o resumo ao chegar em 20:

```js
// NF-001 — colher uma medição do cardápio. Espere a tela parar de mexer
// (uns 3 segundos) antes de rodar, para o LCP já estar fechado.
(() => {
  const CHAVE = 'medicao-nf-001';
  const ALVO = 20;
  const nav = performance.getEntriesByType('navigation')[0];
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  const lcps = performance.getEntriesByType('largest-contentful-paint');
  const medicao = {
    n: 0,
    ttfb: Math.round(nav.responseStart),
    fcp: fcp ? Math.round(fcp.startTime) : null,
    lcp: lcps.length ? Math.round(lcps[lcps.length - 1].startTime) : null,
    load: Math.round(nav.loadEventEnd),
    transferido_kb: Math.round(
      performance.getEntriesByType('resource')
        .reduce((s, r) => s + (r.transferSize || 0), nav.transferSize || 0) / 1024
    ),
  };

  const serie = JSON.parse(sessionStorage.getItem(CHAVE) || '[]');
  medicao.n = serie.length + 1;
  serie.push(medicao);
  sessionStorage.setItem(CHAVE, JSON.stringify(serie));
  console.log(`medição ${serie.length}/${ALVO}`, medicao);

  if (serie.length >= ALVO) {
    // Ordem de posto: com 20 medições, o p95 é a 19ª em ordem crescente.
    const p = (campo, q) => {
      const v = serie.map((m) => m[campo]).filter((x) => typeof x === 'number')
        .sort((a, b) => a - b);
      return v.length ? v[Math.ceil(q * v.length) - 1] : null;
    };
    console.table(serie);
    console.log('--- resumo (ms) ---');
    console.table({
      LCP: { minimo: p('lcp', 0.001), mediana: p('lcp', 0.5), p95: p('lcp', 0.95), maximo: p('lcp', 1) },
      load: { minimo: p('load', 0.001), mediana: p('load', 0.5), p95: p('load', 0.95), maximo: p('load', 1) },
    });
    console.log('NF-001 (p95 do LCP < 2000 ms):', p('lcp', 0.95) < 2000 ? 'PASSOU' : 'NÃO PASSOU');
  }
})();
```

O ritmo é: **recarregar → esperar uns 3 segundos → seta para cima → Enter**.
Vinte vezes. Para começar uma série nova:
`sessionStorage.removeItem('medicao-nf-001')`.

### O "primeiro toque responde"

O número acima diz quando a tela ficou pronta; ele não diz se ela responde.
Grave a tela do tablet, ou filme com outro celular a 60 fps, e meça:

1. do início da navegação até a grade aparecer;
2. da hora do toque em um produto até o detalhe abrir.

Três repetições bastam para o cruzamento. Se a grade aparece rápido e o toque
demora, **o número do LCP está mentindo** e é isso que precisa ser registrado.

## 4. Resultado

### Série principal — 1280×800, paisagem

| # | TTFB (ms) | FCP (ms) | LCP (ms) | load (ms) | KB |
|---:|---:|---:|---:|---:|---:|
| 1 | | | | | |
| … | | | | | |
| 20 | | | | | |

| Resumo | LCP (ms) |
|---|---:|
| Mínimo | |
| Mediana | |
| **p95** | |
| Máximo | |

**p95 abaixo de 2000 ms?** ( ) sim, passou  ( ) não passou

### Checagem nas outras larguras (P10)

> Três execuções em cada uma bastam: aqui a pergunta é se o layout quebra ou
> se o custo muda de patamar, não o p95.

| Largura | LCP mediano (ms) | Layout quebrou? | Observação |
|---|---:|---|---|
| 960×600 | | | |
| 1440×900 | | | |

### Primeiro toque

| Repetição | Grade visível (ms) | Toque → detalhe (ms) |
|---:|---:|---:|
| 1 | | |
| 2 | | |
| 3 | | |

## 5. Leitura do resultado

- [ ] **Passou.** p95 abaixo de 2 s no aparelho e na rede de verdade.
- [ ] **Passou apertado** (entre 1,7 s e 2 s). Vale anotar o que está mais
      pesado: com o cardápio crescendo, isso vira reprovação sozinho.
- [ ] **Não passou.** O que estava mais lento:
  - [ ] fotos acima do teto da §18.4
  - [ ] muitos produtos na primeira tela
  - [ ] resposta lenta do servidor (veja o TTFB)
  - [ ] rede do salão fraca naquela mesa (NF-019)
  - [ ] o aparelho (e aí a conversa é com o NF-017, a escolha do modelo)
- [ ] **Não medido no aparelho real.** Então isto **não é aceite**: é
      referência, e a pendência continua aberta.

## 6. O que fazer a respeito

> Uma linha por ação, com dono e prazo.

- [ ] `__________`

## 7. Quem mediu

| Campo | Valor |
|---|---|
| Data | AAAA-MM-DD |
| Quem mediu | |
| Quem conferiu | |
| Duração da sessão de medição | |
