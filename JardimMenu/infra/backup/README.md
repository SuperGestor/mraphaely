# Backup e restauração do Jardim Menu

Atende o **NF-011**: backup automático diário, com ao menos uma restauração
completa executada e registrada antes da primeira subida a produção, e repetida
antes de cada fase que migra o banco.

Esta pasta é autossuficiente: dá para copiá-la sozinha para o servidor. O texto
para quem vai **operar** está em `docs/operacao/BACKUP.md`; aqui ficam a
instalação e as opções.

## O que tem aqui

| Arquivo | Para que serve |
|---|---|
| `backup.sh` | A rotina diária: dump do banco, papéis, fotos do Storage, manifesto de contagens, cópia externa, retenção e aviso no Telegram |
| `restaurar.sh` | Restaura o último backup de produção **no staging** e confere as contagens. Recusa produção sem dupla confirmação |
| `lib/comum.sh` | Funções comuns (log, Telegram, leitura da configuração, acesso ao Postgres) |
| `exemplo/backup.env.exemplo` | Modelo da configuração. O arquivo real mora em `/etc/jardim-menu/backup.env`, fora do git |
| `exemplo/rclone.conf.exemplo` | Modelo do destino externo (Backblaze B2, S3 ou Google Drive) |
| `systemd/jardim-backup.service` | A unidade que roda o `backup.sh` |
| `systemd/jardim-backup.timer` | O horário: todo dia às 05:00 |

## O que o backup guarda, e por quê

1. **Banco inteiro em formato custom** (`pg_dump -Fc`). Formato custom porque dá
   para listar o conteúdo sem restaurar e para restaurar só uma parte.
2. **Papéis do cluster** (`pg_dumpall --globals-only`). Pequeno, e é o que falta
   quando alguém reinstala o Supabase do zero.
3. **Fotos do Storage** (bucket `produtos`), em `tar.gz`. Elas **não** estão
   dentro do dump do banco: o banco guarda o caminho, o arquivo está em disco.
   Foto perdida é trabalho do gestor perdido (§18.2 dos requisitos).
4. **Manifesto de contagens** das tabelas principais no instante do dump. É
   contra esse arquivo que a restauração se confere. Sem ele, "restaurei" é
   opinião.
5. **`sha256`** de tudo, para detectar arquivo corrompido no caminho.

Antes de aceitar um dump, o script roda `pg_restore --list` nele. Dump truncado
que ninguém abriu é o clássico do backup que não existe.

## Instalação no servidor

Pressupostos: VPS Linux (Ubuntu 22.04 ou 24.04, x86_64), Docker instalado, o
repositório clonado em `/opt/jardim-menu` e o Supabase auto-hospedado subindo
pelo compose da frente de infraestrutura (`infra/compose`).

```bash
# 1. fuso do servidor: a operação é em America/Sao_Paulo (D12)
sudo timedatectl set-timezone America/Sao_Paulo
timedatectl                      # confira antes de confiar

# 2. pacotes
sudo apt update
sudo apt install -y rclone curl   # docker já deve estar instalado

# 3. configuração, fora do git
sudo install -d -m 700 /etc/jardim-menu
sudo cp /opt/jardim-menu/JardimMenu/infra/backup/exemplo/backup.env.exemplo \
        /etc/jardim-menu/backup.env
sudo chmod 600 /etc/jardim-menu/backup.env
sudo nano /etc/jardim-menu/backup.env      # preencha tudo, ver abaixo

# 4. destino externo
sudo rclone config --config /etc/jardim-menu/rclone.conf
sudo chmod 600 /etc/jardim-menu/rclone.conf
sudo rclone --config /etc/jardim-menu/rclone.conf lsd b2:   # confere acesso

# 5. pastas de trabalho
sudo install -d -m 700 /var/backups/jardim-menu
sudo install -d -m 700 /var/lib/jardim-menu/backup

# 6. unidades do systemd
sudo cp /opt/jardim-menu/JardimMenu/infra/backup/systemd/jardim-backup.* \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jardim-backup.timer
systemctl list-timers jardim-backup.timer   # confira a próxima execução
```

Primeira rodada à mão, sem esperar as 5h:

```bash
sudo systemctl start jardim-backup.service
journalctl -u jardim-backup.service -n 60 --no-pager
sudo ls -lh /var/backups/jardim-menu/producao/
```

Para um ensaio que não escreve nada em lugar nenhum:

```bash
sudo /opt/jardim-menu/JardimMenu/infra/backup/backup.sh --simular --sem-remoto
```

## O que você precisa ajustar (e por que não veio pronto)

O compose, o Kong e os scripts de publicação são de outra frente, e os **nomes
de contêiner e os caminhos de volume saem de lá**. Este backup não adivinha
nome: tudo vem da configuração.

```bash
docker ps --format '{{.Names}}'          # nomes dos contêineres
docker inspect -f '{{json .Mounts}}' NOME_DO_CONTAINER_DO_STORAGE | head
```

Com essa saída na mão, preencha em `/etc/jardim-menu/backup.env`:

| Variável | O que é |
|---|---|
| `AMBIENTES` | Lista dos ambientes, separados por espaço (`producao staging`) |
| `<AMBIENTE>_CONTAINER_DB` | Nome do contêiner do Postgres daquele ambiente |
| `<AMBIENTE>_PG_USER`, `_PG_DB`, `_PG_SENHA` | Credenciais do Postgres do ambiente |
| `<AMBIENTE>_DIR_STORAGE` | Pasta das fotos **no host** (o volume montado) |
| `<AMBIENTE>_CONTAINER_STORAGE` + `_CAMINHO_STORAGE` | Alternativa: tirar as fotos de dentro do contêiner |
| `RCLONE_REMOTO` | Destino externo, `remoto:caminho` |
| `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID` | Canal de aviso |
| `TABELAS_CONFERIDAS` | Tabelas cuja contagem entra no manifesto |

O nome da variável é `<AMBIENTE em maiúsculas>_<SUFIXO>`: para o ambiente
`staging`, `STAGING_CONTAINER_DB`. Ambiente novo só precisa entrar em
`AMBIENTES` e ganhar o seu bloco de variáveis; o script não muda.

Se a frente de infraestrutura usar `MODO_BANCO=host` (Postgres exposto em uma
porta em vez de acessado por `docker exec`), troque `MODO_BANCO` e preencha
`<AMBIENTE>_PG_HOST` e `<AMBIENTE>_PG_PORTA`.

## Alternativa em cron

O timer do systemd é o caminho recomendado, porque ele tem `Persistent=true`
(roda quando o servidor volta, se estava desligado às 5h) e porque o registro
vai para o `journalctl`. Se o servidor não tiver systemd, ou se a casa preferir
cron:

```bash
sudo crontab -e
```

```cron
# Backup do Jardim Menu, todo dia às 05:00 (NF-011).
# O cron usa o fuso do servidor: mantenha-o em America/Sao_Paulo.
CRON_TZ=America/Sao_Paulo
0 5 * * * JARDIM_BACKUP_ENV=/etc/jardim-menu/backup.env /opt/jardim-menu/JardimMenu/infra/backup/backup.sh >> /var/log/jardim-backup.log 2>&1
```

Três diferenças que você aceita ao escolher cron:

- servidor desligado às 5h = **backup daquele dia não acontece** (o systemd com
  `Persistent=true` o executa na volta);
- o registro vai para `/var/log/jardim-backup.log`, e o rodízio do arquivo fica
  por sua conta (`logrotate`);
- `CRON_TZ` existe no cron do Debian/Ubuntu; em outras distribuições, confira.

## Testar a restauração

É o item do NF-011 que costuma ficar para depois, e é o único que prova que o
backup serve para alguma coisa:

```bash
sudo /opt/jardim-menu/JardimMenu/infra/backup/restaurar.sh
```

Sem argumento nenhum, ele pega o dump mais recente de **produção**, restaura no
**staging**, confere a contagem de cada tabela principal contra o manifesto e
imprime um bloco pronto para colar em `docs/qa/restauracao-AAAA-MM-DD.md`.

Para provar que a cópia externa também serve (é ela que salva quando o servidor
some), rode a mesma coisa buscando lá fora:

```bash
sudo /opt/jardim-menu/JardimMenu/infra/backup/restaurar.sh --do-remoto
```

Opções úteis: `--tudo` (restaura todos os esquemas, não só `public`, `auth` e
`storage`), `--sem-fotos`, `--arquivo CAMINHO` (escolhe o dump à mão),
`--sem-aviso` (não manda Telegram).

**Restaurar em produção é recusado por padrão.** Para o caso de desastre real,
`--para producao --confirmo-producao` mais duas respostas digitadas no terminal.
Sem terminal, ele recusa: alguém precisa estar olhando.

## Segredos

Nada de senha, token ou chave neste repositório. Tudo mora em
`/etc/jardim-menu/backup.env` e `/etc/jardim-menu/rclone.conf`, com `chmod 600`;
o script avisa se encontrar permissão frouxa. O token do Telegram nunca é
impresso, nem quando o envio falha, porque ele vai dentro da URL.
