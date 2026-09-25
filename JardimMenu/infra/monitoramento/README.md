# Monitoramento do Jardim Menu

Verificação a cada minuto do app e da API de cada ambiente, mais contêineres e
disco, com aviso no Telegram quando cai e quando volta. Fecha o lado de
infraestrutura do **NF-009** (erro de servidor com alerta em canal nomeado); o
registro de erro dentro do app é de outra frente, e usa as mesmas duas
variáveis de Telegram.

O texto para quem vai **operar** — o que cada alerta quer dizer e o que fazer —
está em `docs/operacao/MONITORAMENTO.md`. Aqui ficam a instalação e as opções.

> **No Render** (decisão de 24/09/2026) não existe `docker ps`: a verificação de contêiner
> deixa de existir e passa a ser do painel do Render, e o disco que importa é o do Render,
> não o desta máquina. Use `MODO_PLATAFORMA=render` — ele faz o batimento diário **dizer por
> escrito o que deixou de ser vigiado**, em vez de o canal repetir "monitoramento vivo"
> enquanto a cobertura encolheu. O Storage ganhou verificação própria
> (`/storage/v1/status`), porque ele cai sozinho e o cardápio abre sem foto. Detalhes em
> `infra/render/OPERACAO.md`, §7; configuração no fim de
> `exemplo/monitoramento.env.exemplo`.

## O que tem aqui

| Arquivo | Para que serve |
|---|---|
| `verificar.sh` | A verificação: app, API, contêineres e disco, com controle de repetição |
| `avisar-falha.sh` | O aviso de último recurso: fala quando a própria verificação não roda |
| `lib/comum.sh` | Funções comuns (log, Telegram, configuração) |
| `exemplo/monitoramento.env.exemplo` | Modelo da configuração. O real fica em `/etc/jardim-menu/monitoramento.env` |
| `systemd/jardim-monitor.service` | A unidade que roda a verificação |
| `systemd/jardim-monitor.timer` | O intervalo: a cada minuto, com 3 minutos de carência no boot |
| `systemd/jardim-monitor-falhou.service` | Chamada pelo `OnFailure=` da unidade acima |

## O que é vigiado

| Verificação | Como |
|---|---|
| App de cada ambiente | `GET <URL_APP>/api/saude`, espera 200 |
| API do Supabase de cada ambiente | `GET <URL_API>/auth/v1/health`, com o header `apikey`, espera 200 |
| Contêineres | `docker inspect` de cada nome da lista; qualquer coisa fora de `running` é queda |
| Disco | `df` dos pontos de montagem, alerta acima de 85% |

## Como o aviso evita virar ruído

1. **Duas falhas seguidas antes do primeiro aviso** (`FALHAS_PARA_ALERTAR=2`).
   Um minuto ruim é rede; dois minutos é queda.
2. **Enquanto continuar fora, no máximo um lembrete por hora**
   (`MINUTOS_LEMBRETE=60`). Alerta a cada minuto faria a equipe silenciar o
   canal, e o próximo aviso de verdade não chegaria em ninguém.
3. **Aviso de volta**, com quanto tempo ficou fora.
4. **Histerese no disco**: sobe o alarme em 85% e só considera resolvido abaixo
   de 80%, para o disco parado na fronteira não avisar o dia inteiro.
5. **Uma mensagem por rodada.** Numa queda de verdade cai tudo junto (o banco
   leva auth, rest, storage e realtime embora), e enviadas uma a uma o Telegram
   passa a responder 429 lá pela vigésima mensagem do minuto — os avisos
   seguintes simplesmente não chegavam.
6. **Só marca como avisado depois de o Telegram aceitar.** Antes, o estado era
   gravado antes do envio: aviso recusado, e a queda sumia do canal até o
   lembrete seguinte, ou para sempre com `MINUTOS_LEMBRETE=0`. Hoje, envio
   recusado não marca nada e a rodada do minuto seguinte tenta de novo.
7. **Três minutos de carência depois do boot**, no timer e também dentro do
   script (`CARENCIA_BOOT_SEGUNDOS`). Sem isso, um reinício às 3h20 virava
   "CAIU" de tudo, porque o db ainda estava no `pg_isready` e o app dentro do
   `start_period`.

## Quando é o monitoramento que cai

Verificação que não roda não avisa nada — e `systemctl list-timers` continua
mostrando o timer agendado e saudável, porque ele mostra o agendamento, não o
resultado. Duas coisas cobrem isso:

- **`OnFailure=jardim-monitor-falhou.service`**: qualquer saída diferente de
  zero (caminho errado no `ExecStart`, configuração com uma linha que o
  `source` tenta executar, timeout, OOM) dispara o `avisar-falha.sh`, que lê o
  token **sem executar** a configuração, manda as últimas linhas do journal
  para o Telegram e não repete o mesmo aviso por 60 minutos.
- **Batimento**: de `BATIMENTO_HORAS` em `BATIMENTO_HORAS` (24 por padrão) sai
  um "monitoramento vivo" com quantas verificações a rodada fez. A partir daí,
  **a falta da mensagem diária é em si o alarme** — antes, canal quieto tanto
  podia ser noite tranquila quanto monitoramento morto.

Para ver o aviso de falha funcionando, sem esperar um defeito de verdade:

```bash
sudo systemctl start jardim-monitor-falhou.service
journalctl -u jardim-monitor-falhou.service -n 20 --no-pager
```

O estado fica em `/var/lib/jardim-menu/monitoramento`, um arquivo por
verificação. Para ver o que o monitor acha que está acontecendo agora:

```bash
sudo /opt/jardim/repo/JardimMenu/infra/monitoramento/verificar.sh --estado
```

## Instalação

```bash
sudo install -d -m 700 /etc/jardim-menu /var/lib/jardim-menu/monitoramento
sudo cp /opt/jardim/repo/JardimMenu/infra/monitoramento/exemplo/monitoramento.env.exemplo \
        /etc/jardim-menu/monitoramento.env
sudo chmod 600 /etc/jardim-menu/monitoramento.env
sudo nano /etc/jardim-menu/monitoramento.env     # endereços, chaves, contêineres

# jardim-monitor* pega as três unidades: a verificação, o timer e o aviso de falha.
sudo cp /opt/jardim/repo/JardimMenu/infra/monitoramento/systemd/jardim-monitor* \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jardim-monitor.timer
systemctl list-timers jardim-monitor.timer
```

Teste sem esperar, avisando já na primeira falha:

```bash
sudo /opt/jardim/repo/JardimMenu/infra/monitoramento/verificar.sh --uma-vez
journalctl -u jardim-monitor.service -n 40 --no-pager
```

Teste do caminho de alerta de ponta a ponta (vale a pena fazer uma vez, senão
você só descobre que o Telegram não estava configurado no dia do problema):
pare o contêiner do **staging**, espere dois minutos, confira a mensagem, suba
de novo e confira a mensagem de volta. Nunca faça esse teste em produção.

## O que você precisa ajustar

Os nomes de contêiner e os endereços saem da frente de infraestrutura
(`infra/compose`, Caddy e Kong), e o monitoramento **não** os adivinha:

```bash
docker ps --format '{{.Names}}'     # para <AMBIENTE>_CONTAINERS
```

| Variável | O que é |
|---|---|
| `<AMBIENTE>_URL_APP` | Origem pública do Next.js daquele ambiente |
| `<AMBIENTE>_URL_API` | Origem pública do Kong/Supabase daquele ambiente |
| `<AMBIENTE>_CHAVE_ANON` | Chave anon, para o Kong deixar passar o health |
| `<AMBIENTE>_CONTAINERS` | Nomes dos contêineres que precisam estar de pé |
| `CAMINHO_SAUDE_APP` | `/api/saude` por padrão |
| `LIMITE_DISCO`, `PONTOS_DE_MONTAGEM` | Alerta de disco |
| `BATIMENTO_HORAS` | De quantas em quantas horas sai o "monitoramento vivo". `0` desliga |
| `CARENCIA_BOOT_SEGUNDOS` | Quanto tempo depois do boot o script fica calado. `0` desliga |

**Sem domínio ainda** (A1 dos requisitos): o endereço provisório usa
`sslip.io`, que resolve o IP embutido no nome e aceita certificado Let's
Encrypt de verdade. Isso não é detalhe: o tablet usa `crypto.randomUUID` e
service worker, e os dois só funcionam em contexto seguro. Quando o domínio
existir, troque as quatro URLs aqui e reinicie o timer.

## Duas coisas que este monitoramento **não** faz

- **Não vigia o tablet.** Bateria, versão do app e último contato são o
  `/api/devices/heartbeat` (JM-184), que é da aplicação, não daqui.
- **Não substitui o registro de erro do app** (NF-009). Ele vê que a rota de
  saúde respondeu; um 5xx em `/api/orders` com o resto de pé é o app que
  precisa avisar.
