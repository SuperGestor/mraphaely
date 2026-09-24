# Monitoramento: o que é vigiado e o que fazer quando avisa

A cada minuto, o servidor verifica se o sistema está no ar e avisa no Telegram
quando alguma coisa cai — e de novo quando volta. É o lado de infraestrutura do
**NF-009** (erro de servidor com alerta em canal nomeado).

---

## O que é vigiado

| O quê | Como | O que significa cair |
|---|---|---|
| **O app**, em cada ambiente | `GET /api/saude` | O tablet não abre o cardápio |
| **A API do Supabase**, em cada ambiente | `GET /auth/v1/health` | O app até abre, mas nada carrega nem salva |
| **Os contêineres** | `docker` diz se cada um está de pé | Depende de qual caiu; a tabela abaixo explica |
| **O disco** | Acima de 85% usado | Disco cheio derruba o banco, e o banco derruba tudo |

Verificação a cada minuto, **aviso depois de duas falhas seguidas**. Um minuto
ruim é rede; dois minutos é queda. Enquanto continuar fora, o lembrete vem no
máximo de hora em hora — alerta a cada minuto faz qualquer equipe silenciar o
canal, e aí o próximo aviso de verdade não chega em ninguém.

**Isto aqui não vigia os tablets.** Bateria, versão e último contato do
aparelho são o batimento que o próprio app registra (JM-184), e aparecem no
admin, não no Telegram.

---

## As mensagens

### "CAIU: app de producao"

O cardápio não está abrindo para o cliente. É a mais séria de todas.

1. Confira com os próprios olhos, do celular, no endereço de produção.
2. Se estiver realmente fora, **avise o salão antes de mexer em qualquer
   coisa**: a equipe passa a anotar pedido à mão e o cliente chama o garçom
   pelo botão. A casa funciona sem o sistema.
3. Veja se o contêiner do app está de pé: `docker ps`.
4. Veja o registro dele: `docker logs --tail 100 <nome-do-contêiner-do-app>`.
5. Se o contêiner caiu e não voltou sozinho, suba-o pelo compose da frente de
   infraestrutura (`infra/compose`).

Se o alerta chegou logo depois de uma publicação, a causa mais provável é a
publicação. `docs/operacao/PUBLICACAO.md`, seção **Se der errado**.

### "CAIU: API do Supabase de producao"

O app responde, mas nada carrega: o cardápio fica vazio, o login não entra, o
pedido não sai. Para o cliente, é igual a estar fora do ar.

1. `docker ps` e procure os contêineres do banco, do Kong e do PostgREST.
2. Se o **banco** caiu, olhe o disco primeiro: `df -h`. Postgres com disco
   cheio para de aceitar escrita e às vezes nem sobe.
3. `docker logs --tail 100 <nome-do-contêiner-do-banco>`.

Se a mensagem disser **"recusou a chave"** (HTTP 401 ou 403), não é queda: é a
chave anon errada na configuração do monitoramento, em
`/etc/jardim-menu/monitoramento.env`. Arrume lá, e o alerta some sozinho na
verificação seguinte.

Se disser **"a rota de saúde não existe"** (404), o endereço subiu mas a versão
publicada não tem `/api/saude`. É assunto de publicação, não de servidor.

### "CAIU: contêiner X"

Um pedaço parou. Qual pedaço muda a urgência:

| Contêiner | O que quebra | Urgência |
|---|---|---|
| banco (`db`) | Tudo | Máxima |
| `kong` | Tudo que passa pela API | Máxima |
| `app` | O cardápio no tablet | Máxima |
| `rest` (PostgREST) | Leitura e escrita de dados | Alta |
| `auth` (GoTrue) | Login do admin e da equipe | Alta no serviço, média fora dele |
| `storage` | As fotos dos produtos | Média: o cardápio abre sem foto |
| `realtime` | A tela da equipe demora a atualizar | Média |
| `meta` | Ferramenta de administração | Baixa |

Em qualquer caso: `docker logs --tail 100 <nome>` antes de reiniciar. Contêiner
que é reiniciado sem ninguém ler o registro costuma cair de novo em uma hora, e
aí já não há registro para ler.

### "CAIU: disco em /"

O disco passou de 85%. Isso não é urgente **hoje**, e é urgentíssimo no dia em
que chegar a 100%: o banco para de aceitar escrita, e pedido de cliente some.

Onde o espaço costuma ir, nesta ordem:

```bash
df -h                                    # confirmar
sudo du -sh /var/backups/jardim-menu/*   # backups locais
sudo du -sh /var/lib/docker/*            # imagens e volumes
sudo journalctl --disk-usage             # registros do sistema
```

O que dá para fazer com segurança:

- `sudo docker image prune -a` (apaga imagem sem contêiner usando);
- `sudo journalctl --vacuum-time=14d`;
- baixar `DIAS_RETENCAO_LOCAL` em `/etc/jardim-menu/backup.env` — mas só se a
  cópia externa estiver funcionando, senão você está trocando espaço em disco
  por risco.

O que **não** se faz: apagar coisa dentro de `/var/lib/docker/volumes` na mão.
Ali dentro está o banco.

### "VOLTOU: ..."

Voltou sozinho, ou alguém arrumou. A mensagem diz quanto tempo ficou fora.

Voltar sozinho não encerra o assunto: se um contêiner cai e volta várias vezes
por dia, ele está reiniciando em laço, e o que você viu foi o sintoma. Vale
olhar o registro mesmo com tudo verde.

---

## Ver o estado agora, sem esperar aviso

```bash
sudo /opt/jardim/repo/JardimMenu/infra/monitoramento/verificar.sh --estado
```

Mostra, verificação por verificação, se o monitor a considera `ok` ou `caido`.

Últimas verificações, com os detalhes:

```bash
journalctl -u jardim-monitor.service -n 50 --no-pager
```

O timer está mesmo rodando?

```bash
systemctl list-timers jardim-monitor.timer
```

---

## Silêncio também é problema

Se o canal ficar **totalmente** quieto por mais de uma semana — sem alerta e
sem o resumo semanal do backup —, desconfie do monitoramento, não da sorte.
Teste o caminho inteiro do aviso, uma vez, no staging:

1. pare um contêiner do **staging** (nunca de produção);
2. espere dois minutos e confira a mensagem de queda;
3. suba o contêiner de novo e confira a mensagem de volta.

Se as duas chegarem, o caminho está de pé. Se não chegarem, comece pelo token e
pelo chat do Telegram em `/etc/jardim-menu/monitoramento.env`, e depois pelo
registro do serviço.

---

## O que fazer quando não dá para arrumar agora

A casa continua funcionando sem o sistema, e isso está previsto:

1. **Contingência da mesa.** O gerente desliga o pedido nas mesas pelo admin,
   com motivo. O cliente continua vendo o cardápio e continua chamando o
   garçom, sem tentar pedir por um sistema que não vai responder.
2. **Avise o salão.** Pedido volta a ser anotado à mão e lançado no PDV, que é
   onde a conta sempre esteve.
3. **O botão de chamar o garçom é a saída humana** (JM-187) e foi feito para
   funcionar quando o pedido não funciona. Confira que ele responde antes de
   dizer à equipe que está tudo bem.

Ninguém fica esperando o sistema voltar com o salão cheio. Primeiro a casa
volta a funcionar; depois o sistema.
