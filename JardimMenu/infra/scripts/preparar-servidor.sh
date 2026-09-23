#!/usr/bin/env bash
#
# Prepara um servidor Linux novo para receber o Jardim Menu. Roda como root, e roda
# quantas vezes for preciso: tudo aqui é idempotente, e o que já está pronto é pulado
# com uma linha dizendo isso.
#
# O que ele faz, nesta ordem:
#   1. confere o sistema e os pacotes básicos;
#   2. instala o Docker e o plugin compose, do repositório oficial;
#   3. instala o Node (só para o gerar-segredos.mjs e para scripts avulsos);
#   4. cria o usuário de publicação e as pastas de /opt/jardim;
#   5. cria as duas redes de borda do Docker (staging e produção);
#   6. arruma o SSH para aceitar só chave;
#   7. fecha o firewall, deixando 22 (ou a porta atual do SSH), 80 e 443;
#   8. liga as atualizações de segurança automáticas do sistema.
#
# NÃO tem IP, senha nem domínio aqui dentro, de propósito: o servidor ainda não existe e
# quem o contratar vai descobrir esses valores depois. Tudo que muda entre um servidor e
# outro é opção de linha de comando, com padrão.
#
#   sudo bash preparar-servidor.sh --chave-ssh /caminho/id_ed25519.pub
#
# Opções:
#   --usuario <nome>        usuário de publicação        (padrão jardim)
#   --raiz <caminho>        pasta base no servidor       (padrão /opt/jardim)
#   --chave-ssh <arquivo>   arquivo com uma ou mais chaves públicas a autorizar
#   --porta-ssh <n>         porta a liberar no firewall  (padrão: a porta atual do sshd)
#   --versao-node <n>       série do Node                (padrão 22)
#   --fuso <zona>           fuso do servidor             (padrão America/Sao_Paulo)
#   --swap <GiB>            cria /swapfile deste tamanho (padrão 0, não cria)
#   --sem-firewall          não mexe no ufw
#   --sem-ssh               não mexe na configuração do sshd
#   --sem-node              não instala o Node
#
# O QUE ELE NÃO FAZ, de propósito:
#   - não troca a porta do SSH. Trocar a porta com o firewall meio configurado é a
#     receita conhecida de ficar do lado de fora do próprio servidor. Se quiser trocar,
#     troque à mão, teste em outra sessão e rode este script de novo com --porta-ssh;
#   - não sobe nenhum ambiente. Isso é o publicar.sh;
#   - não gera segredo nenhum. Isso é o gerar-segredos.mjs.

set -Eeuo pipefail

# ---------------------------------------------------------------------------
# Conversa com quem está rodando
# ---------------------------------------------------------------------------

titulo() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
feito()  { printf '   \033[32mok\033[0m    %s\n' "$*"; }
pulado() { printf '   ja feito  %s\n' "$*"; }
aviso()  { printf '   \033[33matencao\033[0m %s\n' "$*"; }
morrer() { printf '\n\033[31merro:\033[0m %s\n\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Opções
# ---------------------------------------------------------------------------

USUARIO=jardim
RAIZ=/opt/jardim
CHAVE_SSH=""
PORTA_SSH=""
VERSAO_NODE=22
FUSO=America/Sao_Paulo
SWAP_GIB=0
MEXER_FIREWALL=sim
MEXER_SSH=sim
INSTALAR_NODE=sim

while [ $# -gt 0 ]; do
  case "$1" in
    --usuario)      USUARIO="${2:?--usuario exige um nome}"; shift 2 ;;
    --raiz)         RAIZ="${2:?--raiz exige um caminho}"; shift 2 ;;
    --chave-ssh)    CHAVE_SSH="${2:?--chave-ssh exige um arquivo}"; shift 2 ;;
    --porta-ssh)    PORTA_SSH="${2:?--porta-ssh exige um número}"; shift 2 ;;
    --versao-node)  VERSAO_NODE="${2:?--versao-node exige um número}"; shift 2 ;;
    --fuso)         FUSO="${2:?--fuso exige uma zona}"; shift 2 ;;
    --swap)         SWAP_GIB="${2:?--swap exige um número}"; shift 2 ;;
    --sem-firewall) MEXER_FIREWALL=nao; shift ;;
    --sem-ssh)      MEXER_SSH=nao; shift ;;
    --sem-node)     INSTALAR_NODE=nao; shift ;;
    -h|--ajuda|--help) sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) morrer "opção desconhecida: $1 (use --ajuda)" ;;
  esac
done

[ "$(id -u)" = "0" ] || morrer "rode como root: sudo bash $0 ..."

# ---------------------------------------------------------------------------
# 1. O sistema
# ---------------------------------------------------------------------------

titulo "Sistema"

[ -r /etc/os-release ] || morrer "não achei /etc/os-release: este script é para Ubuntu/Debian"
# shellcheck disable=SC1091
. /etc/os-release

# O alvo combinado é Ubuntu 22.04/24.04 x86_64. Em outro sistema o script segue, porque
# tudo aqui usa apt, mas avisa: ninguém testou, e é melhor saber antes.
case "${ID:-}" in
  ubuntu) feito "Ubuntu ${VERSION_ID:-?} (${VERSION_CODENAME:-?})" ;;
  debian) aviso "Debian ${VERSION_ID:-?}: combinamos Ubuntu. Segue, mas confira o resultado." ;;
  *)      aviso "sistema ${ID:-desconhecido}: fora do combinado (Ubuntu 22.04/24.04)." ;;
esac

ARQUITETURA="$(dpkg --print-architecture)"
[ "$ARQUITETURA" = "amd64" ] || aviso "arquitetura $ARQUITETURA: as imagens fixadas são x86_64 (amd64)."

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# ca-certificates e curl para os repositórios; gnupg para as chaves; git para trazer o
# repositório da aplicação; ufw para o firewall; jq porque todo diagnóstico no servidor
# acaba precisando; tzdata para o fuso.
apt-get install -y -qq ca-certificates curl gnupg git ufw jq tzdata >/dev/null
feito "pacotes básicos (ca-certificates, curl, gnupg, git, ufw, jq)"

if [ "$(cat /etc/timezone 2>/dev/null || true)" = "$FUSO" ]; then
  pulado "fuso do servidor já é $FUSO"
else
  timedatectl set-timezone "$FUSO"
  feito "fuso do servidor: $FUSO"
fi
# O fuso do servidor é conforto de log. A conta de "dia" e de horário de funcionamento
# fica sempre no banco, pela função shift_date (regra 5 do CLAUDE.md).

# ---------------------------------------------------------------------------
# 2. Docker
#
# Do repositório oficial da Docker, e não o docker.io do Ubuntu: precisamos do plugin
# compose v2 e do buildx (a imagem do app usa contexto nomeado, `--build-context back=`).
# Passos conforme https://docs.docker.com/engine/install/ubuntu/
# ---------------------------------------------------------------------------

titulo "Docker"

if [ -f /etc/apt/keyrings/docker.asc ]; then
  pulado "chave do repositório Docker"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  feito "chave do repositório Docker"
fi

# UBUNTU_CODENAME cobre as distribuições derivadas, onde VERSION_CODENAME é o nome delas
# e não o do Ubuntu de base; o repositório da Docker só conhece o do Ubuntu.
CODINOME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
[ -n "$CODINOME" ] || morrer "não descobri o codinome da distribuição (VERSION_CODENAME vazio)"
LINHA_DOCKER="deb [arch=${ARQUITETURA} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${CODINOME} stable"
if [ "$(cat /etc/apt/sources.list.d/docker.list 2>/dev/null || true)" = "$LINHA_DOCKER" ]; then
  pulado "repositório Docker"
else
  echo "$LINHA_DOCKER" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  feito "repositório Docker"
fi

if docker compose version >/dev/null 2>&1 && docker buildx version >/dev/null 2>&1; then
  pulado "Docker, compose e buildx ($(docker --version | cut -d, -f1))"
else
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  feito "Docker, compose e buildx instalados"
fi

systemctl enable --now docker >/dev/null 2>&1 || true

# Log do Docker sem teto enche o disco de um VPS pequeno em semanas, e disco cheio
# derruba o Postgres. Só escrevemos o arquivo se ele não existir, para não passar por
# cima de ajuste de quem administra o servidor.
if [ -f /etc/docker/daemon.json ]; then
  pulado "/etc/docker/daemon.json já existe (confira se o log tem teto)"
else
  install -d -m 0755 /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
JSON
  systemctl restart docker
  feito "teto de log do Docker: 3 arquivos de 10 MB por contêiner"
fi

# ---------------------------------------------------------------------------
# 3. Node
#
# Serve para o gerar-segredos.mjs e para scripts avulsos no servidor. O Node do Ubuntu
# 22.04 é antigo demais (o gerador usa base64url e replaceAll, que pedem Node 15+), então
# vem do repositório da NodeSource, com a chave adicionada à mão, sem `curl | bash`.
# ---------------------------------------------------------------------------

titulo "Node"

if [ "$INSTALAR_NODE" = "nao" ]; then
  pulado "Node (pedido com --sem-node)"
else
  MAIOR_NODE=0
  if command -v node >/dev/null 2>&1; then
    MAIOR_NODE="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  fi
  if [ "$MAIOR_NODE" -ge 18 ] 2>/dev/null; then
    pulado "Node $(node --version)"
  else
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    chmod a+r /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${VERSAO_NODE}.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq
    apt-get install -y -qq nodejs >/dev/null
    feito "Node $(node --version)"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Usuário de publicação e pastas
# ---------------------------------------------------------------------------

titulo "Usuário e pastas"

if id -u "$USUARIO" >/dev/null 2>&1; then
  pulado "usuário $USUARIO"
else
  # Com shell de verdade: é por ele que alguém entra por SSH para publicar.
  useradd --create-home --shell /bin/bash --comment "Publicacao do Jardim Menu" "$USUARIO"
  feito "usuário $USUARIO criado"
fi

# Estar no grupo docker equivale a ser root na máquina. É consciente: quem publica
# precisa subir contêiner, e a alternativa (sudo em cada comando do publicar.sh) não
# torna ninguém mais seguro, só mais incômodo.
if id -nG "$USUARIO" | tr ' ' '\n' | grep -qx docker; then
  pulado "$USUARIO já está no grupo docker"
else
  usermod -aG docker "$USUARIO"
  feito "$USUARIO entrou no grupo docker (vale a partir do próximo login)"
fi

install -d -m 0755 -o "$USUARIO" -g "$USUARIO" "$RAIZ"
# ambientes/ guarda os .env com TODOS os segredos: só o dono entra.
install -d -m 0700 -o "$USUARIO" -g "$USUARIO" "$RAIZ/ambientes"
install -d -m 0700 -o "$USUARIO" -g "$USUARIO" "$RAIZ/backups"
install -d -m 0755 -o "$USUARIO" -g "$USUARIO" "$RAIZ/repo"
install -d -m 0755 -o "$USUARIO" -g "$USUARIO" "$RAIZ/logs"
feito "$RAIZ com ambientes/ (0700), backups/ (0700), repo/ e logs/"

# ---------------------------------------------------------------------------
# 5. Redes de borda
#
# Ficam fora do compose porque são compartilhadas: o proxy entra nas duas, e cada
# ambiente entra só na sua. É isso que deixa o Caddy falar com os dois sem que staging e
# produção se enxerguem (NF-012).
# ---------------------------------------------------------------------------

titulo "Redes do Docker"

for REDE in jardim-borda-staging jardim-borda-producao; do
  if docker network inspect "$REDE" >/dev/null 2>&1; then
    pulado "rede $REDE"
  else
    docker network create "$REDE" >/dev/null
    feito "rede $REDE criada"
  fi
done

# ---------------------------------------------------------------------------
# 6. SSH só por chave
#
# A ordem importa: primeiro autorizamos a chave, e só depois desligamos a senha. O
# contrário deixa quem está rodando o script do lado de fora do servidor.
# ---------------------------------------------------------------------------

titulo "SSH"

if [ "$MEXER_SSH" = "nao" ]; then
  pulado "SSH (pedido com --sem-ssh)"
else
  CASA="$(getent passwd "$USUARIO" | cut -d: -f6)"
  AUTORIZADAS="$CASA/.ssh/authorized_keys"
  install -d -m 0700 -o "$USUARIO" -g "$USUARIO" "$CASA/.ssh"
  touch "$AUTORIZADAS"
  chown "$USUARIO:$USUARIO" "$AUTORIZADAS"
  chmod 0600 "$AUTORIZADAS"

  if [ -n "$CHAVE_SSH" ]; then
    [ -r "$CHAVE_SSH" ] || morrer "não consigo ler $CHAVE_SSH"
    NOVAS=0
    while IFS= read -r LINHA; do
      # Linha vazia e comentário não são chave.
      case "$LINHA" in ""|\#*) continue ;; esac
      if grep -qxF "$LINHA" "$AUTORIZADAS"; then continue; fi
      printf '%s\n' "$LINHA" >> "$AUTORIZADAS"
      NOVAS=$((NOVAS + 1))
    done < "$CHAVE_SSH"
    [ "$NOVAS" -gt 0 ] && feito "$NOVAS chave(s) autorizada(s) para $USUARIO" || pulado "chaves de $CHAVE_SSH já estavam autorizadas"
  fi

  # Se o root já entra por chave, aproveitamos as dele: é o caso comum do VPS recém
  # entregue, onde o provedor instalou a chave do comprador no root.
  if [ ! -s "$AUTORIZADAS" ] && [ -s /root/.ssh/authorized_keys ]; then
    cat /root/.ssh/authorized_keys >> "$AUTORIZADAS"
    chown "$USUARIO:$USUARIO" "$AUTORIZADAS"
    feito "chaves do root copiadas para $USUARIO"
  fi

  if [ ! -s "$AUTORIZADAS" ]; then
    # Desligar a senha agora tranca todo mundo do lado de fora. Melhor sair avisando.
    aviso "nenhuma chave pública autorizada para $USUARIO."
    aviso "NÃO vou desligar a senha do SSH: isso trancaria você do lado de fora."
    aviso "rode de novo com --chave-ssh <arquivo .pub> quando tiver a chave."
  else
    ARQUIVO_SSHD=/etc/ssh/sshd_config.d/60-jardim.conf
    if ! grep -qE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config; then
      # Ubuntu 22.04 e 24.04 já trazem esse Include na primeira linha; outro sistema pode
      # não ter, e aí o arquivo abaixo seria escrito e ignorado em silêncio.
      aviso "/etc/ssh/sshd_config não inclui sshd_config.d/*.conf; ajuste à mão."
    fi
    install -d -m 0755 /etc/ssh/sshd_config.d
    cat > "$ARQUIVO_SSHD" <<'CONF'
# Jardim Menu: SSH só por chave.
# Senha em servidor exposto à internet é achada por força bruta em horas, e a pilha
# inteira (banco, chaves, fotos) está atrás deste login.
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
PermitEmptyPasswords no
CONF
    chmod 0644 "$ARQUIVO_SSHD"
    # sshd -t recusa configuração inválida ANTES do reload. Sem isto, um erro de digitação
    # aqui derruba o sshd e o servidor vira um tijolo com IP.
    if sshd -t; then
      systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
      feito "SSH só por chave (senha desligada, root só por chave)"
      aviso "ANTES de fechar esta sessão, abra outra por chave e confirme que entra."
    else
      rm -f "$ARQUIVO_SSHD"
      morrer "sshd -t recusou a configuração; nada foi alterado"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 7. Firewall
#
# Só 80 e 443 (o Caddy) e a porta do SSH. O Postgres não aparece: ele não publica porta
# nenhuma no compose, e quem precisa de psql entra por SSH e usa `docker compose exec`.
# ---------------------------------------------------------------------------

titulo "Firewall"

if [ "$MEXER_FIREWALL" = "nao" ]; then
  pulado "firewall (pedido com --sem-firewall)"
else
  if [ -z "$PORTA_SSH" ]; then
    # A porta que o sshd está mesmo usando, e não a que supomos: em VPS revendido é
    # comum o provedor já ter trocado.
    PORTA_SSH="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || true)"
    PORTA_SSH="${PORTA_SSH:-22}"
  fi
  case "$PORTA_SSH" in
    ''|*[!0-9]*) morrer "--porta-ssh precisa ser um número, recebi '$PORTA_SSH'" ;;
  esac

  ufw default deny incoming  >/dev/null
  ufw default allow outgoing >/dev/null
  # A regra do SSH vem ANTES do enable, sempre.
  ufw allow "${PORTA_SSH}/tcp" comment 'SSH' >/dev/null
  ufw allow 80/tcp  comment 'HTTP: desafio ACME e redirecionamento' >/dev/null
  ufw allow 443/tcp comment 'HTTPS' >/dev/null
  # O compose do proxy publica 443/udp para o HTTP/3. Sem esta linha o navegador tenta o
  # caminho anunciado e espera o tempo todo antes de cair para TCP.
  ufw allow 443/udp comment 'HTTP/3 (QUIC)' >/dev/null
  ufw --force enable >/dev/null
  feito "ufw ligado: entra só ${PORTA_SSH}/tcp, 80/tcp, 443/tcp e 443/udp"
  # Porta publicada por contêiner passa por fora do ufw (o Docker escreve direto no
  # iptables). Na nossa pilha só o Caddy publica porta, e são justamente 80 e 443, que
  # já queremos abertas. Se um dia alguém acrescentar `ports:` em outro serviço, ele
  # aparece na internet sem o ufw dizer nada — está no README.
  aviso "não acrescente 'ports:' a nenhum serviço da pilha: o Docker fura o ufw."
fi

# ---------------------------------------------------------------------------
# 8. Atualização de segurança do sistema
#
# Vale para o sistema operacional. As imagens da pilha ficam FIXAS por versão no .env
# (NF-018): quem as atualiza é uma decisão, passando por staging antes.
# ---------------------------------------------------------------------------

titulo "Atualizações de segurança"

apt-get install -y -qq unattended-upgrades >/dev/null
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
# Número alto para o arquivo vencer o 50unattended-upgrades padrão, sem editá-lo.
cat > /etc/apt/apt.conf.d/52jardim-seguranca <<'CONF'
// Jardim Menu: só correção de segurança entra sozinha.
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
// Reinício é decisão de gente: reiniciar sozinho no meio do serviço derruba o pedido da
// mesa. O que pede reinício fica registrado em /var/run/reboot-required.
Unattended-Upgrade::Automatic-Reboot "false";
CONF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
feito "só correções de segurança, sem reinício automático"

# ---------------------------------------------------------------------------
# Swap, opcional
#
# Postgres, sete contêineres e o Next em 2 GB de RAM é apertado: o primeiro pico de
# memória mata o processo mais gordo, que costuma ser o banco. Swap não faz milagre, mas
# troca "morreu" por "ficou lento".
# ---------------------------------------------------------------------------

if [ "$SWAP_GIB" != "0" ]; then
  titulo "Swap"
  case "$SWAP_GIB" in
    ''|*[!0-9]*) morrer "--swap precisa ser um número inteiro de GiB" ;;
  esac
  if [ -f /swapfile ]; then
    pulado "/swapfile já existe"
  else
    fallocate -l "${SWAP_GIB}G" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_GIB * 1024)) status=none
    chmod 0600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -qxF '/swapfile none swap sw 0 0' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    feito "swap de ${SWAP_GIB} GiB ligado e no /etc/fstab"
  fi
fi

# ---------------------------------------------------------------------------
# Resumo
# ---------------------------------------------------------------------------

titulo "Servidor preparado"
cat <<RESUMO

  usuário de publicação ... $USUARIO
  pasta base .............. $RAIZ
  segredos vão para ....... $RAIZ/ambientes  (0700, fora do git)
  repositório vai para .... $RAIZ/repo

Próximos passos, nesta ordem (o README da pasta infra explica cada um):

  1. entre como $USUARIO e clone o repositório em $RAIZ/repo
  2. gere os segredos do staging:
       node $RAIZ/repo/JardimMenu/infra/scripts/gerar-segredos.mjs \\
         --ambiente staging --ip <IP público deste servidor>
  3. preencha o proxy.env com os nomes que o comando acima imprimiu e suba o Caddy
  4. publique o staging:
       bash $RAIZ/repo/JardimMenu/infra/scripts/publicar.sh staging
  5. só depois de o staging rodar, repita 2 a 4 para produção

Antes da primeira subida a produção, NF-011 exige uma restauração completa de backup
executada e registrada em qa/restauracao-AAAA-MM-DD.md. O backup.sh e o restaurar.sh
estão nesta mesma pasta.

RESUMO
