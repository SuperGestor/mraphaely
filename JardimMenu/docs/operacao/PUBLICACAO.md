# Como publicar uma versão nova

Procedimento escrito do **NF-012**: staging separado de produção, e nenhuma
migração roda direto em produção sem ter rodado em staging antes.

Este documento é para ser seguido na hora, com ele aberto. Se algum passo não
fizer sentido, **pare e pergunte**, em vez de improvisar: publicar por conta
própria é o tipo de coisa que dá certo nove vezes e estraga o sábado à noite
na décima.

---

## O básico

Existem dois ambientes, no mesmo servidor, com bancos separados:

| Ambiente | Para que serve | Quem usa |
|---|---|---|
| **staging** | Ensaio. Tudo passa por aqui primeiro | Só a equipe do projeto |
| **produção** | O que os tablets das mesas acessam | Clientes, no salão |

As duas regras que não se negociam:

1. **Nada chega a produção sem ter rodado em staging.** Vale para código,
   migração de banco, variável de ambiente e imagem de contêiner.
2. **Migração de banco não tem botão de desfazer.** O caminho de volta é o
   backup. Por isso o passo 3 deste procedimento é tirar um backup na mão,
   mesmo que o diário tenha rodado hoje de manhã.

---

## Antes de começar

Confira, nesta ordem:

- [ ] **Horário.** Publicação acontece com o salão fechado. Nunca no meio do
      serviço, nunca na sexta à noite.
- [ ] **Alguém acompanhando.** Quem publica não publica sozinho: uma segunda
      pessoa fica de olho no canal do Telegram durante a janela.
- [ ] **O que vai subir está decidido.** Anote o commit ou a tag. "A última
      versão" não é resposta: em duas semanas ninguém lembra qual era.
- [ ] **Migrações novas.** Veja se `back/supabase/migrations/` ganhou arquivo
      desde a última subida. Se ganhou, o passo do banco vale; se não ganhou,
      ele é pulado e você anota que pulou.
- [ ] **O monitoramento está de pé.** `systemctl list-timers jardim-monitor.timer`.
      Publicar com o monitoramento desligado é publicar de olhos fechados.
- [ ] **O backup de hoje existe.** `ls -lh /var/backups/jardim-menu/producao/`.

---

## Passo a passo

### 1. Anotar o começo

Abra um registro da publicação (pode ser uma mensagem no canal) com: data,
hora, quem está publicando, versão que sobe e versão que está em produção
agora. **A versão que está em produção agora é o seu caminho de volta.** Sem
ela anotada, o retorno vira adivinhação.

### 2. Publicar no staging

```bash
cd /opt/jardim-menu
git fetch --all
git checkout <a-versão-que-vai-subir>
```

O script de publicação é da frente de infraestrutura e mora em
`JardimMenu/infra/scripts/`. Confira o nome exato com `ls JardimMenu/infra/scripts/`
antes da primeira vez e corrija a linha abaixo neste documento se for diferente:

```bash
sudo JardimMenu/infra/scripts/publicar.sh staging
```

### 3. Backup na mão, antes de tocar no banco

Mesmo que o backup automático tenha rodado às 5h. O que vai quebrar é o que
você está prestes a fazer, não o que aconteceu de madrugada.

```bash
sudo /opt/jardim-menu/JardimMenu/infra/backup/backup.sh --ambiente producao
```

Espere terminar e **confira que o arquivo apareceu**:

```bash
ls -lht /var/backups/jardim-menu/producao/ | head -5
```

### 4. Deixar o staging parecido com a produção

Uma migração só é testada de verdade se rodar sobre dados parecidos com os de
verdade. Restaure o backup de produção no staging:

```bash
sudo /opt/jardim-menu/JardimMenu/infra/backup/restaurar.sh
```

Ele já confere a contagem das tabelas e imprime o resultado. Se aparecer
`DIVERGENTE`, **pare aqui**: o problema é no backup, e publicar em cima de um
backup que não fecha é publicar sem rede de segurança.

### 5. Rodar a migração no staging

```bash
sudo JardimMenu/infra/scripts/migrar.sh staging
```

Cada migração roda inteira em uma transação (§8.2 dos requisitos): ou entra
tudo, ou não entra nada. Se der erro, o banco do staging continua como estava,
e o erro é o assunto da conversa antes de qualquer outra coisa.

### 6. Conferir o staging com as mãos

Esta é a parte que as pessoas pulam, e é a parte que existe. No staging:

- [ ] O cardápio abre e mostra as fotos.
- [ ] O login do admin funciona, e o cardápio aparece para editar.
- [ ] O pareamento do tablet gera o QR e o aparelho entra.
- [ ] O botão de chamar o garçom responde. Ele é a única saída humana (JM-187)
      e precisa funcionar mesmo quando o resto não funciona.
- [ ] **A partir da Fase B:** um pedido de verdade, do tablet, aparece na tela
      da equipe.
- [ ] `GET /api/saude` responde 200 (é o que o monitoramento usa).
- [ ] O endereço é **https** e o cadeado está válido. Sem contexto seguro, o
      tablet perde `crypto.randomUUID` e o service worker, e o app quebra de um
      jeito difícil de entender.
- [ ] O que mudou nesta versão funciona. Óbvio, e mesmo assim é o que escapa.

Se qualquer item falhar: **a publicação termina aqui**. Produção não é onde se
descobre.

### 7. Publicar em produção

```bash
sudo JardimMenu/infra/scripts/publicar.sh producao
```

### 8. Rodar a migração em produção

```bash
sudo JardimMenu/infra/scripts/migrar.sh producao
```

A mesma migração, que já rodou em staging no passo 5. Se aqui ela se comportar
diferente do que se comportou lá, **pare e chame ajuda**: os dois ambientes
deveriam estar iguais, e essa diferença é um problema maior do que a versão que
você está subindo.

### 9. Conferir a produção

A mesma lista do passo 6, na produção, e mais:

- [ ] Um tablet de verdade, de uma mesa de verdade, abre o cardápio.
- [ ] O canal do Telegram **não** recebeu alerta de queda nos últimos minutos.
- [ ] `verificar.sh --estado` mostra tudo em `ok`:

```bash
sudo /opt/jardim-menu/JardimMenu/infra/monitoramento/verificar.sh --estado
```

### 10. Os tablets (NF-018)

A atualização não pode depender de tocar em cada tablet, um por um. O service
worker é "rede primeiro, com a última versão guardada para quando a rede cair"
(NF-004), então o tablet pega a versão nova sozinho na próxima navegação.

Confira em **um** tablet antes de considerar publicado: se ele continuar na
versão antiga depois de alguns minutos e de uma navegação, é problema de
publicação, não de aparelho. Também confira que o `device_token` sobreviveu:
o tablet não pode ter caído na tela de pareamento.

### 11. Fechar o registro

Anote: horário do fim, se rodou migração, o que foi conferido, o que deu
errado (mesmo o que foi contornado) e quanto tempo levou. Em três meses, esse
registro é a única memória confiável do que aconteceu.

---

## Se der errado

Primeiro decida **o quê** deu errado, porque o caminho de volta é diferente:

### O app subiu quebrado, e o banco não mudou

O mais simples. Volte o app para a versão anterior, aquela que você anotou no
passo 1:

```bash
cd /opt/jardim-menu
git checkout <a-versão-anterior>
sudo JardimMenu/infra/scripts/publicar.sh producao
```

Confira o `/api/saude`, confira um tablet, avise no canal. Só depois vá
descobrir o que houve.

### A migração falhou no meio

Cada migração roda em uma transação: se ela falhou, o banco voltou sozinho ao
que era. Não rode de novo "para ver se passa". Leia o erro, resolva no staging
e recomece o procedimento do zero.

### A migração passou, mas o resultado está errado

Este é o caso ruim, e é para ele que existe o passo 3. Migração aplicada não se
desfaz sozinha: o caminho é restaurar o backup daquele momento **em produção**,
o que apaga tudo que entrou desde o backup.

```bash
sudo /opt/jardim-menu/JardimMenu/infra/backup/restaurar.sh \
     --para producao --confirmo-producao
```

O script pede duas confirmações digitadas, de propósito. **Antes de digitar a
primeira, responda em voz alta:** o que vai se perder entre o horário do backup
e agora? Se a casa esteve aberta nesse intervalo, são pedidos de clientes. Se a
resposta for "não sei", não digite: chame quem sabe.

### Deu errado e você não sabe o quê

1. Ligue a contingência das mesas (`/api/tables/[id]/ordering`) para o cliente
   ver o cardápio e chamar o garçom, sem tentar pedir por um sistema quebrado.
2. Avise a equipe do salão: o pedido volta a ser anotado à mão.
3. Volte o app para a versão anterior.
4. Só então investigue.

Nesta ordem. A casa continua funcionando sem o sistema; ela não continua
funcionando com um sistema que aceita pedido e perde.

---

## O que nunca fazer

- Publicar direto em produção "porque é uma mudança pequena". O NF-012 não tem
  exceção para mudança pequena, e mudança pequena é justamente a que ninguém
  testa.
- Rodar migração em produção sem ter rodado em staging.
- Editar arquivo dentro do contêiner em produção. O que você arrumar assim some
  na próxima publicação, e ninguém vai lembrar que estava lá.
- Publicar com o salão aberto.
- Mexer em `/etc/jardim-menu/*.env` no meio de uma publicação. Se a variável
  mudou, ela entra como passo próprio, com o seu próprio teste no staging.

## Variáveis de ambiente

Cada ambiente tem o seu arquivo, mantido pela frente de infraestrutura em
`JardimMenu/infra/ambientes/` (confira o nome exato com `ls`). Ao mudar uma
variável, ela muda **no staging primeiro**, exatamente como código.

Três que valem lembrete:

| Variável | Cuidado |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Segredo de servidor. **Nunca** sob `NEXT_PUBLIC_`, nunca no bundle do navegador (§4 regra 3) |
| `NEXT_PUBLIC_APP_ORIGIN` | É a origem que vai dentro do QR de pareamento. Trocar depois de provisionar os tablets invalida o pareamento: o `device_token` mora no armazenamento local, que é por origem |
| `ALERT_TELEGRAM_BOT_TOKEN` / `ALERT_TELEGRAM_CHAT_ID` | O app usa as mesmas duas do backup e do monitoramento, para o aviso de erro do NF-009. Elas são passadas ao contêiner do app pelo arquivo do ambiente |
