# Registro de restauração — AAAA-MM-DD

> **Este arquivo é um modelo.** Copie-o com a data do dia no nome
> (`restauracao-2026-09-30.md`), preencha enquanto executa e apague estas
> linhas entre `>`. Os requisitos chamam esse nome de
> `qa/restauracao-YYYY-MM-DD.md`: é o mesmo formato, ano-mês-dia.
>
> Sem este registro, a restauração não conta para o **NF-011**. O requisito
> pede a restauração *executada e registrada*.

## 1. Por que esta restauração aconteceu

> Marque o que se aplica.

- [ ] Antes da primeira subida a produção (exigência do NF-011)
- [ ] Antes de uma fase que mexe no banco. Qual: `__________`
- [ ] Rotina mensal de conferência
- [ ] Troca do destino externo de backup
- [ ] Troca da versão do Postgres
- [ ] Desastre de verdade. O que houve: `__________`

## 2. Quem e quando

| Campo | Valor |
|---|---|
| Data | AAAA-MM-DD |
| Hora de início | `__:__` |
| Hora de término | `__:__` |
| Quem executou | |
| Quem acompanhou | |

## 3. O que foi restaurado

| Campo | Valor |
|---|---|
| Arquivo de backup | `jardim-producao-AAAA-MM-DDTHHMM.dump` |
| Data e hora do backup | |
| Tamanho do arquivo | |
| Veio de onde | ( ) disco do servidor  ( ) cópia externa (`--do-remoto`) |
| Ambiente de origem | produção |
| Ambiente de destino | staging |
| As fotos do Storage entraram | ( ) sim  ( ) não. Por quê: |
| Esquemas restaurados | `public auth storage` (padrão) / outro: |

> **A cópia externa precisa ser testada pelo menos uma vez.** É ela que salva
> no dia em que o servidor some, e é a única que nunca foi exercitada se todo
> teste usar o arquivo local.

## 4. O comando

```bash
sudo /opt/jardim/repo/JardimMenu/infra/backup/restaurar.sh
```

> Cole abaixo a saída do script, inteira. É ela que dá a contagem e o tempo.

```
(cole aqui)
```

## 5. Conferência das tabelas

> O script já imprime esta tabela pronta para colar. Se alguma linha vier como
> `DIVERGENTE`, **ela não se explica sozinha**: escreva na seção 7 o que era e
> por que divergiu.

| Tabela | No backup | Restaurado | Situação |
|---|---:|---:|---|
| `stores` | | | |
| `store_users` | | | |
| `categories` | | | |
| `products` | | | |
| `option_groups` | | | |
| `options` | | | |
| `product_option_groups` | | | |
| `tables` | | | |
| `devices` | | | |
| `table_sessions` | | | |
| `table_tabs` | | | |
| `orders` | | | |
| `order_items` | | | |
| `menu_events` | | | |

## 6. Conferência com as mãos

> Contagem igual prova que as linhas chegaram. Não prova que o sistema
> funciona. Abra o staging restaurado e confira:

- [ ] O cardápio abre e mostra **as fotos** (se as fotos não entraram, diga
      aqui que não entraram).
- [ ] O admin entra com um usuário de verdade e o cardápio aparece para editar.
- [ ] Um produto conhecido está lá, com preço certo e complementos certos.
- [ ] As mesas e os dispositivos estão na lista.
- [ ] O `device_token` de um tablet do backup ainda autentica (ou: por que não).
- [ ] **A partir da Fase B:** um pedido antigo aparece com os itens completos.

## 7. O que deu errado

> Escreva mesmo o que foi contornado, e mesmo o que parece bobagem. Erro do
> `pg_restore` que foi ignorado entra aqui, com o texto do erro. Esta seção é a
> mais útil do documento; registro com "nada a relatar" em toda restauração
> costuma significar que ninguém olhou.

```
(cole aqui as linhas de erro do pg_restore, se houver)
```

## 8. Tempo de recuperação

| Campo | Valor |
|---|---|
| Tempo que o script levou | `____` s (o script imprime) |
| Tempo até dar para usar o sistema | `____` min (incluindo reiniciar contêiner, conferir) |
| Este tempo seria aceitável num sábado à noite? | ( ) sim  ( ) não, e o que fazer a respeito: |

## 9. Resultado

- [ ] **Aprovado.** As contagens bateram e a conferência manual passou.
- [ ] **Aprovado com ressalva.** Qual: `__________`
- [ ] **Reprovado.** O backup não serve como está. O que precisa mudar antes da
      próxima tentativa: `__________`

> Reprovado é resultado legítimo, e é o motivo de o teste existir. Reprovado
> **antes** da subida custa uma tarde; descoberto depois custa os dados da casa.

## 10. O que muda por causa deste teste

> Uma linha por ação, com dono. Se não mudou nada, escreva que não mudou.

- [ ] `__________`
