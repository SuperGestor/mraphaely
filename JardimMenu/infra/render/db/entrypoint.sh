#!/bin/sh
# Entrypoint da imagem de banco do Jardim Menu no Render.
#
# Ele faz UMA coisa antes de entregar o controle ao entrypoint original da imagem:
# garante que a chave do pgsodium viva DENTRO do disco de dados.
#
# POR QUE ISTO EXISTE
#
# Restrição do Render: um serviço tem NO MÁXIMO UM disco. O nosso vai em
# /var/lib/postgresql/data, que é o PGDATA. O infra/docker-compose.yml, que continua
# sendo o que roda na máquina de quem desenvolve e na esteira, tem um SEGUNDO volume,
# db-config:/etc/postgresql-custom, e é ele que guarda entre reinícios a chave
# /etc/postgresql-custom/pgsodium_root.key, que o pgsodium_getkey.sh da imagem sorteia na
# primeira vez que alguém pede por ela. No Render esse segundo volume não cabe: sem este
# script a chave voltaria a viver na camada da imagem, e nasceria diferente a cada deploy.
#
# Isto não é urgência, e a medição de 24/09/2026 é a razão: um contêiner NOVO sobre o
# MESMO disco (que é exatamente o que um deploy do Render faz) reabre o banco com tudo
# intacto mesmo com a chave trocada. Nada no nosso schema é cifrado — as 8 migrações do
# projeto não criam extensão nenhuma, não usam pgsodium e não usam o Vault.
#
# É o dia seguinte que este script cobre. No instante em que alguém guardar um segredo no
# Vault ou cifrar uma coluna com pgsodium, a chave passa a SER o dado: perdê-la é perder o
# dado, e o banco não avisa — ele devolve erro de chave inválida num lugar qualquer, muito
# depois. A essa altura ninguém vai lembrar desta conversa. Por isso a chave passa a morar
# no disco, e o caminho que o postgresql.conf conhece (pgsodium.getkey_script e
# vault.getkey_script, os dois apontando para /usr/lib/postgresql/bin/pgsodium_getkey.sh,
# que por sua vez tem o caminho da chave fixo no código) vira um link simbólico para lá.
#
# Nada aqui engole erro: qualquer passo que não dê certo para a subida na hora, alto, em
# vez de deixar o banco subir com a chave no lugar errado — que é o defeito que ninguém vê.

set -eu

# Caminho fixo dentro do pgsodium_getkey.sh da imagem. Se ele mudar numa versão futura,
# este script continua criando o link, mas ele deixa de ser lido: confira ao trocar a
# versão da imagem (NF-018 manda toda troca passar por staging antes).
CAMINHO_DA_CHAVE=/etc/postgresql-custom/pgsodium_root.key

# O disco. Sai de PGDATA de propósito: se um dia o PGDATA precisar virar uma subpasta do
# ponto de montagem, a chave acompanha sem ninguém precisar editar este arquivo.
DIR_DADOS="${PGDATA:-/var/lib/postgresql/data}"
CHAVE_NO_DISCO="$DIR_DADOS/pgsodium_root.key"

GETKEY=/usr/lib/postgresql/bin/pgsodium_getkey.sh

aviso() { echo "jardim-entrypoint: $*"; }
morrer() { echo "jardim-entrypoint: ERRO: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. O link simbólico: /etc/postgresql-custom/pgsodium_root.key -> disco.
# ---------------------------------------------------------------------------
if [ -L "$CAMINHO_DA_CHAVE" ]; then
  alvo_atual="$(readlink "$CAMINHO_DA_CHAVE")"
  if [ "$alvo_atual" != "$CHAVE_NO_DISCO" ]; then
    morrer "$CAMINHO_DA_CHAVE já é um link para '$alvo_atual', e não para '$CHAVE_NO_DISCO'. Alguém mudou o desenho da imagem ou o PGDATA; não vou adivinhar qual dos dois vale."
  fi
  aviso "link da chave do pgsodium já apontava para o disco ($CHAVE_NO_DISCO)"

elif [ -e "$CAMINHO_DA_CHAVE" ]; then
  # Arquivo comum onde esperávamos o link. A imagem 17.6.1.167 não traz nenhum (a chave é
  # criada em execução), então isto só acontece se uma versão futura passar a trazer.
  # Mover para o disco, sim. Escolher entre duas chaves diferentes, não.
  if [ -e "$CHAVE_NO_DISCO" ]; then
    morrer "existe chave na camada da imagem ($CAMINHO_DA_CHAVE) E no disco ($CHAVE_NO_DISCO). Só uma delas abre o dado cifrado; escolher no escuro seria pior do que parar. Decida na mão qual fica."
  fi
  if [ ! -s "$DIR_DADOS/PG_VERSION" ]; then
    # Mesma checagem que o docker-entrypoint.sh original usa para saber se o banco já
    # existe. Ver o porquê da recusa no passo 2.
    morrer "há chave em $CAMINHO_DA_CHAVE mas o disco ainda não tem banco. Mover a chave para dentro de um PGDATA vazio faria o initdb recusar o diretório. Suba uma vez sem esta chave ou limpe-a antes."
  fi
  mv "$CAMINHO_DA_CHAVE" "$CHAVE_NO_DISCO" || morrer "não consegui mover a chave para $CHAVE_NO_DISCO"
  ln -s "$CHAVE_NO_DISCO" "$CAMINHO_DA_CHAVE" || morrer "não consegui criar o link $CAMINHO_DA_CHAVE"
  aviso "chave que estava na camada da imagem foi movida para o disco"

else
  mkdir -p "$(dirname "$CAMINHO_DA_CHAVE")" || morrer "não consegui criar $(dirname "$CAMINHO_DA_CHAVE")"
  ln -s "$CHAVE_NO_DISCO" "$CAMINHO_DA_CHAVE" || morrer "não consegui criar o link $CAMINHO_DA_CHAVE -> $CHAVE_NO_DISCO"
  aviso "link da chave do pgsodium criado: $CAMINHO_DA_CHAVE -> $CHAVE_NO_DISCO"
fi

# ---------------------------------------------------------------------------
# 2. A chave em si, quando ela ainda não existe.
# ---------------------------------------------------------------------------
if [ ! -e "$CHAVE_NO_DISCO" ]; then
  if [ -s "$DIR_DADOS/PG_VERSION" ]; then
    if [ -x "$GETKEY" ]; then
      # Sorteia com o script da PRÓPRIA imagem, para não existirem duas ideias de formato
      # de chave. Ele escreve ATRAVÉS do link, ou seja, no disco.
      #
      # A saída vai para /dev/null porque ele termina imprimindo a chave em claro, e log
      # do Render é log: segredo não aparece em log nem em linha de comando (regra do
      # projeto). Erro dele continua chegando, porque só o stdout é descartado.
      "$GETKEY" >/dev/null || morrer "$GETKEY falhou ao sortear a chave"
    else
      # Nunca deveria acontecer: sem este script o postgresql.conf aponta para o vazio.
      # Ainda assim, alto e com o mesmo formato (32 bytes em hexadecimal), em vez de calado.
      aviso "AVISO: $GETKEY não existe nesta imagem; sorteando a chave aqui, no mesmo formato"
      head -c 32 /dev/urandom | od -A n -t x1 | tr -d ' \n' > "$CHAVE_NO_DISCO" \
        || morrer "não consegui sortear a chave em $CHAVE_NO_DISCO"
    fi
    aviso "chave do pgsodium criada no disco"
  else
    # DE PROPÓSITO não criamos a chave aqui. O initdb recusa um diretório de dados que não
    # esteja vazio ("directory ... exists but is not empty") e sai com erro; criar um
    # arquivo dentro do disco ANTES da criação do banco derrubaria o primeiro deploy.
    #
    # Quem cria a chave neste caso é o pgsodium_getkey.sh da imagem, logo depois do initdb,
    # escrevendo através do link que o passo 1 já deixou pronto — ou seja, no lugar certo.
    # A permissão dela fica por conta do umask do Postgres nesta primeira subida (mais
    # restrita, nunca mais aberta) e o passo 3 a acerta na subida seguinte.
    aviso "disco ainda sem banco: a chave não é criada agora, para o initdb não recusar um PGDATA não vazio"
  fi
fi

# ---------------------------------------------------------------------------
# 3. Permissão da chave.
# ---------------------------------------------------------------------------
if [ -e "$CHAVE_NO_DISCO" ]; then
  # 0640, dono postgres: é a permissão que o initdb desta imagem dá a todo arquivo dentro
  # do PGDATA (o POSTGRES_INITDB_ARGS da imagem traz --allow-group-access), e a chave
  # agora é vizinha deles. Mais aberto do que isso entregaria a chave a qualquer processo
  # do contêiner.
  chmod 0640 "$CHAVE_NO_DISCO" || morrer "não consegui ajustar a permissão de $CHAVE_NO_DISCO"
  # O chown só é possível como root. O entrypoint original roda como root, ajusta o dono
  # do PGDATA inteiro e só então cai para o usuário postgres — então quando este script
  # não é root, ou já somos postgres, ou o original vai arrumar logo adiante.
  if [ "$(id -u)" = "0" ]; then
    chown postgres:postgres "$CHAVE_NO_DISCO" || morrer "não consegui ajustar o dono de $CHAVE_NO_DISCO"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Entrega ao entrypoint original, sem mexer nos argumentos.
#
# É ele que cria o PGDATA, roda o initdb na primeira vez, sobe um servidor temporário,
# roda o /docker-entrypoint-initdb.d/migrate.sh (que por sua vez roda os nossos três
# scripts assados, com set -eu e ON_ERROR_STOP=1) e só depois entrega ao postgres de
# verdade. Nada disso muda.
# ---------------------------------------------------------------------------
original="$(command -v docker-entrypoint.sh || true)"
[ -n "$original" ] || morrer "docker-entrypoint.sh não foi encontrado no PATH. A imagem base mudou de desenho; pare e olhe antes de subir."

exec "$original" "$@"
