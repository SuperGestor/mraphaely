#!/usr/bin/env bash
#
# Restauração do backup do Jardim Menu (NF-011: "ao menos uma restauração
# completa executada antes da primeira subida a produção e registrada em
# qa/restauracao-YYYY-MM-DD.md").
#
# O caminho normal, e o único que roda sem briga, é este:
#
#     restaurar.sh                 # último backup de PRODUÇÃO dentro do STAGING
#
# Ele pega o dump mais recente de produção, CONFERE o arquivo antes de encostar
# no destino, restaura no staging, devolve as fotos do Storage, compara a
# contagem das tabelas principais com o manifesto gravado na hora do backup e
# imprime o resultado já no formato do registro de QA.
#
# Restaurar EM PRODUÇÃO é recusado por padrão. Só acontece com a opção
# --confirmo-producao mais duas respostas digitadas à mão, porque restaurar por
# cima da produção apaga o que aconteceu desde o backup: é operação de desastre,
# não de rotina. A recusa olha o BANCO de destino, e não o apelido do ambiente.
#
# Uso:
#   restaurar.sh [--de producao] [--para staging] [--arquivo CAMINHO]
#                [--do-remoto] [--tudo] [--sem-fotos] [--sem-aviso]
#                [--config CAMINHO] [--simular] [--confirmo-producao]
#
# Códigos de saída:
#   0  restauração conferida
#   1  não achei backup nenhum para restaurar
#   2  erro de uso ou de configuração
#   3  restauração NÃO comprovada: divergência nas contagens, ou as fotos não voltaram
#   4  recusado / não confirmado
#   5  o arquivo de backup não presta (soma ou índice), e nada foi tocado no destino

set -euo pipefail

DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/comum.sh
. "$DIR_SCRIPT/lib/comum.sh"

ARQUIVO_CONFIG="${JARDIM_BACKUP_ENV:-/etc/jardim-menu/backup.env}"
ORIGEM="producao"
ALVO="staging"
ARQUIVO=""
DO_REMOTO="nao"
TUDO="nao"
COM_FOTOS="sim"
COM_AVISO="sim"
SIMULAR="nao"
CONFIRMA_PRODUCAO="nao"

while [ $# -gt 0 ]; do
  case "$1" in
    --de) ORIGEM="${2:-}"; shift 2 ;;
    --para) ALVO="${2:-}"; shift 2 ;;
    --arquivo) ARQUIVO="${2:-}"; shift 2 ;;
    --config) ARQUIVO_CONFIG="${2:-}"; shift 2 ;;
    --do-remoto) DO_REMOTO="sim"; shift ;;
    --tudo) TUDO="sim"; shift ;;
    --sem-fotos) COM_FOTOS="nao"; shift ;;
    --sem-aviso) COM_AVISO="nao"; shift ;;
    --simular) SIMULAR="sim"; shift ;;
    --confirmo-producao) CONFIRMA_PRODUCAO="sim"; shift ;;
    -h|--help) sed -n '2,32p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) jm_erro "Opção desconhecida: $1"; exit 2 ;;
  esac
done

jm_carregar_config "$ARQUIVO_CONFIG"

DIR_BACKUP="${DIR_BACKUP:-/var/backups/jardim-menu}"
TABELAS_CONFERIDAS="${TABELAS_CONFERIDAS:-stores store_users categories products option_groups options product_option_groups tables devices table_sessions table_tabs orders order_items menu_events}"
ESQUEMAS_RESTAURACAO="${ESQUEMAS_RESTAURACAO:-public auth storage}"
# Quais ambientes são produção de verdade. É lista, e não a palavra "producao"
# escrita no código, porque o README convida a criar ambiente novo ("prod",
# "loja2") e a trava precisa acompanhar. Ver o bloco da trava.
AMBIENTES_PRODUCAO="${AMBIENTES_PRODUCAO:-producao}"
RCLONE_REMOTO="${RCLONE_REMOTO:-}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/jardim-menu/rclone.conf}"

jm_validar_ambiente "$ORIGEM"
jm_validar_ambiente "$ALVO"
jm_exige_comandos awk sort date tar gzip

INICIO="$(date +%s)"
DATA_DIA="$(date '+%Y-%m-%d')"

# ------------------------------------------------------- o destino de verdade

# Tudo que o pg_restore vai usar sai daqui, e sai ANTES da trava de propósito:
# a trava precisa saber em qual banco a escrita vai cair, não só qual apelido
# foi digitado em --para.
modo="$(jm_var_ambiente "$ALVO" MODO_BANCO "${MODO_BANCO:-docker}")"
# supabase_admin: os schemas auth e storage pertencem a ele. Como `postgres`, o pg_restore
# leva "permission denied for schema auth" em cada objeto dos dois, e a restauração volta
# sem as contas da equipe e sem o registro das fotos (achado de 23/09/2026).
user="$(jm_var_ambiente "$ALVO" PG_USER "${PG_USER:-supabase_admin}")"
banco_alvo="$(jm_var_ambiente "$ALVO" PG_DB "${PG_DB:-postgres}")"
senha="$(jm_var_ambiente "$ALVO" PG_SENHA "")"
host="$(jm_var_ambiente "$ALVO" PG_HOST "127.0.0.1")"
porta="$(jm_var_ambiente "$ALVO" PG_PORTA "5432")"
container_alvo="$(jm_var_ambiente "$ALVO" CONTAINER_DB "")"

if [ "$modo" = "docker" ] && [ -z "$container_alvo" ]; then
  jm_erro "Falta ${ALVO^^}_CONTAINER_DB em $ARQUIVO_CONFIG (MODO_BANCO=docker)."
  exit 2
fi

# Identidade do banco que um ambiente escreve, em uma linha só, para comparar um
# ambiente com outro. Vazio quando o ambiente não tem destino configurado: sem
# isso, dois ambientes em branco pareceriam o mesmo banco.
destino_do_ambiente() {
  local amb="$1" m c
  m="$(jm_var_ambiente "$amb" MODO_BANCO "${MODO_BANCO:-docker}")"
  if [ "$m" = "docker" ]; then
    c="$(jm_var_ambiente "$amb" CONTAINER_DB "")"
    [ -n "$c" ] || return 0
    printf 'docker:%s/%s' "$c" "$(jm_var_ambiente "$amb" PG_DB "${PG_DB:-postgres}")"
  else
    printf 'host:%s:%s/%s' \
      "$(jm_var_ambiente "$amb" PG_HOST "127.0.0.1")" \
      "$(jm_var_ambiente "$amb" PG_PORTA "5432")" \
      "$(jm_var_ambiente "$amb" PG_DB "${PG_DB:-postgres}")"
  fi
}

DESTINO_ALVO="$(destino_do_ambiente "$ALVO")"
if [ "$modo" = "docker" ]; then
  DESTINO_LEGIVEL="contêiner $container_alvo, banco $banco_alvo"
else
  DESTINO_LEGIVEL="$host:$porta, banco $banco_alvo"
fi

# ---------------------------------------------------------------- a trava

# A recusa é explícita: o alvo padrão é o staging, e produção só com dupla
# confirmação. Restaurar em produção sobrescreve tudo que foi pedido desde o
# backup, e no piloto isso é pedido de cliente que some.
#
# A trava compara o BANCO DE DESTINO, e não a string "producao". Até 23/09/2026
# ela era `[ "$ALVO" = "producao" ]`, e isso deixava dois buracos: (a) um
# STAGING_CONTAINER_DB apontando para jardim-producao-db — os dois blocos do
# backup.env.exemplo só diferem na palavra, e os contêineres reais só diferem no
# meio do nome — fazia `restaurar.sh` sem argumento nenhum reescrever a PRODUÇÃO
# sem uma única pergunta; (b) qualquer produção que não se chamasse literalmente
# "producao" ficava sem trava. Por isso o teste é por nome E por destino.
ALVO_EH_PRODUCAO="nao"
PRODUCAO_ATINGIDA=""
TRAVA_POR_DESTINO="nao"
for amb_prod in $AMBIENTES_PRODUCAO; do
  jm_validar_ambiente "$amb_prod" || exit 2
  if [ "$ALVO" = "$amb_prod" ]; then
    ALVO_EH_PRODUCAO="sim"; PRODUCAO_ATINGIDA="$amb_prod"; break
  fi
  destino_prod="$(destino_do_ambiente "$amb_prod")"
  if [ -n "$DESTINO_ALVO" ] && [ "$DESTINO_ALVO" = "$destino_prod" ]; then
    ALVO_EH_PRODUCAO="sim"; PRODUCAO_ATINGIDA="$amb_prod"; TRAVA_POR_DESTINO="sim"; break
  fi
done

if [ "$ALVO_EH_PRODUCAO" = "sim" ]; then
  jm_erro "PEDIDO DE RESTAURAÇÃO EM PRODUÇÃO ('$PRODUCAO_ATINGIDA': $DESTINO_LEGIVEL)."
  if [ "$TRAVA_POR_DESTINO" = "sim" ]; then
    jm_erro "Atenção: você pediu --para $ALVO, mas esse ambiente aponta para o MESMO banco de '$PRODUCAO_ATINGIDA'."
    jm_erro "Quase sempre isso é ${ALVO^^}_CONTAINER_DB errado em $ARQUIVO_CONFIG. Confira antes de qualquer outra coisa."
  fi
  jm_erro "Isso apaga tudo que entrou no banco depois do backup escolhido."
  jm_erro "Se o que você quer é TESTAR o backup, rode sem argumento nenhum: o alvo padrão é o staging."
  if [ "$SIMULAR" = "sim" ]; then
    jm_aviso "--simular: seguindo só para mostrar o destino resolvido. Nada será escrito."
  else
    if [ "$CONFIRMA_PRODUCAO" != "sim" ]; then
      jm_erro "Recusado. Para seguir mesmo assim, repita com --confirmo-producao."
      exit 4
    fi
    if [ ! -t 0 ]; then
      jm_erro "Recusado: restauração em produção exige terminal, e este processo não tem um."
      jm_erro "Não automatize este caminho. Alguém precisa estar olhando."
      exit 4
    fi
  fi
fi

# ---------------------------------------------------------------- o arquivo

baixar_do_remoto() {
  local origem="$1" destino_dir="$2"
  [ -n "$RCLONE_REMOTO" ] || { jm_erro "RCLONE_REMOTO vazio: não há de onde baixar."; return 1; }
  jm_exige_comandos rclone || return 1

  local nome base_nome
  # O nome do arquivo começa com a data em ISO, então ordem alfabética é ordem
  # cronológica: o último da lista é o mais recente.
  nome="$(rclone --config "$RCLONE_CONFIG" lsf "$RCLONE_REMOTO/$origem" --include '*.dump' | sort | tail -n 1)"
  [ -n "$nome" ] || { jm_erro "Nenhum .dump encontrado em $RCLONE_REMOTO/$origem"; return 1; }
  base_nome="${nome%.dump}"

  mkdir -p "$destino_dir"
  jm_log "Baixando $nome do destino externo"
  # O stdout desta função é o caminho do arquivo baixado, e só isso: qualquer
  # linha que o rclone imprima vai para stderr, senão ela volta grudada no
  # caminho e o pg_restore procura um arquivo com esse nome (já aconteceu).
  rclone --config "$RCLONE_CONFIG" copyto "$RCLONE_REMOTO/$origem/$nome" "$destino_dir/$nome" >&2

  # Os companheiros do dump. Antes de 23/09/2026 só o manifesto vinha, e por
  # isso a restauração a partir da cópia externa NUNCA trazia as fotos e ainda
  # dizia "este backup não tem arquivo de fotos" para um backup que tinha.
  local extra
  for extra in contagens.tsv storage.tar.gz globais.sql.gz sha256; do
    rclone --config "$RCLONE_CONFIG" copyto \
      "$RCLONE_REMOTO/$origem/${base_nome}.${extra}" \
      "$destino_dir/${base_nome}.${extra}" >/dev/null 2>&1 \
      || jm_aviso "Não achei ${base_nome}.${extra} no destino externo."
  done
  printf '%s' "$destino_dir/$nome"
}

if [ -z "$ARQUIVO" ]; then
  if [ "$DO_REMOTO" = "sim" ]; then
    ARQUIVO="$(baixar_do_remoto "$ORIGEM" "$DIR_BACKUP/$ORIGEM/baixados")"
  else
    ARQUIVO="$(find "$DIR_BACKUP/$ORIGEM" -maxdepth 1 -type f -name "jardim-${ORIGEM}-*.dump" \
      -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-)"
  fi
fi

if [ -z "$ARQUIVO" ] || [ ! -f "$ARQUIVO" ]; then
  jm_erro "Não achei nenhum backup de '$ORIGEM' para restaurar."
  jm_erro "Procurei em: $DIR_BACKUP/$ORIGEM (use --do-remoto para buscar na cópia externa)."
  exit 1
fi

BASE="${ARQUIVO%.dump}"
MANIFESTO="${BASE}.contagens.tsv"
FOTOS="${BASE}.storage.tar.gz"
SOMAS="${BASE}.sha256"

# ------------------------------------------------- conferir o arquivo primeiro

# O pg_restore roda com --clean --if-exists: ele despeja TODOS os DROP antes de
# recarregar os dados. Quer dizer que a destruição do destino começa antes de
# qualquer prova de que o arquivo presta — um dump truncado derruba as tabelas e
# só avisa no meio da carga. Por isso a conferência vem aqui, antes do primeiro
# DROP: o .sha256 que o backup.sh grava existia desde sempre e não era lido em
# lugar nenhum do projeto, e o pg_restore --list que o backup faz na gravação não
# era refeito na leitura.
ITENS_INDICE="?"

conferir_dump() {
  # Chamada em contexto de condição, o que desliga o `set -e` DENTRO dela: cada
  # comando abaixo confere o próprio status na mão.
  local esperado="" obtido="" indice="" estado=0

  if [ ! -f "$SOMAS" ]; then
    jm_aviso "Sem $(basename "$SOMAS") ao lado do dump: não dá para provar que o arquivo não mudou desde o backup."
  elif ! command -v sha256sum >/dev/null 2>&1; then
    jm_aviso "sha256sum não existe neste servidor: seguindo sem conferir a soma."
  else
    # O backup grava as somas com o nome simples do arquivo (ele roda dentro da
    # pasta), então procuramos a linha pelo basename. Um `*` na frente do nome é
    # o modo binário do sha256sum.
    esperado="$(awk -v nome="$(basename "$ARQUIVO")" \
      '{ n=$2; sub(/^\*/, "", n); if (n == nome) { print $1; exit } }' "$SOMAS")"
    if [ -z "$esperado" ]; then
      jm_aviso "$(basename "$SOMAS") não tem linha para $(basename "$ARQUIVO"); seguindo sem conferir a soma."
    else
      obtido="$(sha256sum "$ARQUIVO" | awk '{print $1}')"
      if [ "$obtido" != "$esperado" ]; then
        jm_erro "SOMA NÃO BATE em $(basename "$ARQUIVO")."
        jm_erro "  esperado: $esperado"
        jm_erro "  obtido  : $obtido"
        jm_erro "O arquivo mudou depois do backup (disco, cópia interrompida, download parcial). NÃO vou encostar no destino."
        return 1
      fi
      jm_log "sha256 confere com $(basename "$SOMAS")."
    fi
  fi

  # Abrir o índice é o mesmo teste que o backup.sh faz na hora de gravar. Aqui
  # ele vale de novo: o arquivo passou dias no disco e pode ter vindo de fora.
  if [ "$modo" = "docker" ]; then
    indice="$(docker exec -i "$container_alvo" pg_restore --list < "$ARQUIVO" 2>&1)" || estado=$?
  else
    indice="$(pg_restore --list "$ARQUIVO" 2>&1)" || estado=$?
  fi
  if [ "$estado" -ne 0 ]; then
    jm_erro "O dump não abre: pg_restore --list saiu com código $estado. Nada foi tocado no destino."
    printf '%s\n' "$indice" | tail -n 5 | sed 's/^/    /' >&2
    return 1
  fi

  # Linhas de item do índice começam com "NNN; ". As de comentário começam com ";".
  ITENS_INDICE="$(printf '%s\n' "$indice" | grep -c -E '^[0-9]+;' || true)"
  if [ "$ITENS_INDICE" -lt 1 ]; then
    jm_erro "O dump abre mas está VAZIO: nenhum item no índice. Nada foi tocado no destino."
    return 1
  fi
  jm_log "Índice do dump lido: $ITENS_INDICE itens."
  return 0
}

conferir_dump || exit 5

# ---------------------------------------------------------------- o aviso na tela

cat <<FIM
------------------------------------------------------------------
 RESTAURAÇÃO DO JARDIM MENU
   de   : $ORIGEM
   para : $ALVO   ($DESTINO_LEGIVEL)
   dump : $(basename "$ARQUIVO")  ($(jm_tamanho "$ARQUIVO"))
   feito em: $(date -r "$ARQUIVO" '+%Y-%m-%d %H:%M' 2>/dev/null || echo 'data desconhecida')
   índice: $ITENS_INDICE itens (o arquivo abre)
   fotos: $( [ -f "$FOTOS" ] && echo "$(basename "$FOTOS") ($(jm_tamanho "$FOTOS"))" || echo 'sem arquivo de fotos neste backup' )
   esquemas: $( [ "$TUDO" = "sim" ] && echo 'todos' || echo "$ESQUEMAS_RESTAURACAO" )
------------------------------------------------------------------
FIM

if [ "$SIMULAR" = "sim" ]; then
  jm_log "SIMULAÇÃO: o arquivo foi conferido e o destino resolvido. Nada foi escrito."
  exit 0
fi

if [ "$ALVO_EH_PRODUCAO" = "sim" ]; then
  resposta=""
  printf 'Digite exatamente RESTAURAR PRODUCAO para seguir: '
  read -r resposta || true
  if [ "$resposta" != "RESTAURAR PRODUCAO" ]; then
    jm_erro "Não confirmado. Nada foi tocado."
    exit 4
  fi
  resposta=""
  printf 'Agora digite o nome do arquivo (%s): ' "$(basename "$ARQUIVO")"
  read -r resposta || true
  if [ "$resposta" != "$(basename "$ARQUIVO")" ]; then
    jm_erro "O nome não bate. Nada foi tocado."
    exit 4
  fi
  jm_aviso "Confirmado duas vezes. Seguindo com a restauração EM PRODUÇÃO."
elif [ -t 0 ]; then
  # Pausa curta com o destino já resolvido na tela. O contêiner impresso acima é
  # o que vai levar os DROP: ele precisa ser lido ANTES, não depois.
  printf 'Confira o destino acima. ENTER para restaurar, Ctrl-C para desistir: '
  read -r _ || true
else
  jm_log "Sem terminal: seguindo sem a pausa de conferência."
fi

# ---------------------------------------------------------------- restaurar

opcoes_restore=(--clean --if-exists --no-password)
if [ "$TUDO" = "nao" ]; then
  for esquema in $ESQUEMAS_RESTAURACAO; do
    opcoes_restore+=("--schema=$esquema")
  done
fi

REGISTRO="$(mktemp -t jardim-restauracao-XXXXXX.log)"
jm_log "Restaurando o banco. O registro completo fica em $REGISTRO"

# O pg_restore NÃO roda com --exit-on-error de propósito: num banco Supabase
# sempre sobra erro de objeto que já existe ou de extensão que não se apaga, e
# parar no primeiro deles esconderia o resto. A prova de que deu certo é a
# conferência das contagens, logo abaixo, e não a ausência de erro no log.
estado_restore=0
if [ "$modo" = "docker" ]; then
  docker exec -i -e PGPASSWORD="$senha" "$container_alvo" \
    pg_restore -U "$user" -d "$banco_alvo" "${opcoes_restore[@]}" \
    < "$ARQUIVO" > "$REGISTRO" 2>&1 || estado_restore=$?
else
  PGPASSWORD="$senha" pg_restore -h "$host" -p "$porta" -U "$user" -d "$banco_alvo" \
    "${opcoes_restore[@]}" "$ARQUIVO" > "$REGISTRO" 2>&1 || estado_restore=$?
fi

erros_ignorados="$(grep -c -E '^pg_restore: (error|erro)' "$REGISTRO" || true)"
jm_log "pg_restore terminou com código $estado_restore e $erros_ignorados linha(s) de erro no registro."
if [ "$erros_ignorados" -gt 0 ]; then
  jm_log "Primeiras linhas de erro (o resto está em $REGISTRO):"
  grep -E '^pg_restore: (error|erro)' "$REGISTRO" | head -n 10 | sed 's/^/    /'
fi

# ---------------------------------------------------------------- fotos

# Dois caminhos, os MESMOS que o backup.sh usa para guardar:
#   <ALVO>_DIR_STORAGE                              -> pasta no host
#   <ALVO>_CONTAINER_STORAGE + <ALVO>_CAMINHO_STORAGE -> de dentro do contêiner
#
# Até 23/09/2026 a restauração conhecia só o primeiro. Só que o compose deste
# projeto guarda o Storage num volume nomeado (storage-arquivos:/var/lib/storage),
# onde não existe pasta no host para apontar: no servidor de verdade as fotos
# entravam no backup e não voltavam por script nenhum — e o veredito continuava
# dizendo "RESTAURAÇÃO CONFERIDA", porque só as tabelas eram conferidas.
FOTOS_SITUACAO="nao-tentado"
FOTOS_DETALHE=""

restaurar_fotos() {
  # Chamada em contexto de condição, o que desliga o `set -e` DENTRO dela: cada
  # comando abaixo confere o próprio status na mão.
  local dir_alvo container_st caminho_st guardado
  dir_alvo="$(jm_var_ambiente "$ALVO" DIR_STORAGE "")"
  container_st="$(jm_var_ambiente "$ALVO" CONTAINER_STORAGE "")"
  caminho_st="$(jm_var_ambiente "$ALVO" CAMINHO_STORAGE "/var/lib/storage")"

  # Mesma ordem do backup.sh: a pasta no host só vale se ela existir de verdade.
  # DIR_STORAGE preenchido com caminho que não existe, havendo contêiner, é o
  # caso em que o backup foi tirado por dentro do contêiner — restaurar na pasta
  # criaria um diretório vazio no host e deixaria o Storage real intocado.
  if [ -n "$dir_alvo" ] && { [ -d "$dir_alvo" ] || [ -z "$container_st" ]; }; then
    guardado="${dir_alvo}.antes-de-${DATA_DIA}-$(date +%H%M)"
    jm_log "Guardando as fotos atuais de $ALVO em $guardado e extraindo as do backup."
    if [ -d "$dir_alvo" ]; then
      mv "$dir_alvo" "$guardado" \
        || { FOTOS_DETALHE="não consegui mover $dir_alvo para $guardado"; return 1; }
    fi
    mkdir -p "$dir_alvo" || { FOTOS_DETALHE="não consegui criar $dir_alvo"; return 1; }
    tar -C "$dir_alvo" -xzf "$FOTOS" \
      || { FOTOS_DETALHE="o tar falhou ao extrair em $dir_alvo"; return 1; }
    FOTOS_DETALHE="extraídas em $dir_alvo (as anteriores ficaram em $guardado)"
    jm_log "Fotos restauradas em $dir_alvo. A pasta antiga ficou em $guardado (apague depois de conferir)."
    return 0
  fi

  if [ -n "$container_st" ]; then
    guardado="$DIR_BACKUP/$ALVO/jardim-${ALVO}-storage-antes-de-${DATA_DIA}T$(date +%H%M).tar.gz"
    mkdir -p "$DIR_BACKUP/$ALVO" \
      || { FOTOS_DETALHE="não consegui criar $DIR_BACKUP/$ALVO"; return 1; }
    jm_log "Storage do $ALVO é volume do Docker: guardando em $guardado o que está lá hoje."
    # Mesma assimetria do backup.sh: o tar roda dentro do contêiner e o gzip no
    # host, porque a imagem do storage-api tem tar e pode não ter gzip.
    if ! docker exec -i "$container_st" tar -C "$caminho_st" -cf - . | gzip -6 > "${guardado}.parcial"; then
      rm -f "${guardado}.parcial"
      FOTOS_DETALHE="não consegui guardar as fotos atuais de $container_st:$caminho_st"
      return 1
    fi
    mv "${guardado}.parcial" "$guardado" \
      || { FOTOS_DETALHE="não consegui gravar $guardado"; return 1; }

    jm_log "Extraindo as fotos do backup dentro de $container_st:$caminho_st"
    # Extração POR CIMA, sem apagar nada antes: um `rm -rf` com caminho vindo do
    # arquivo de configuração, dentro de um contêiner, é risco maior do que o
    # problema que resolveria. Arquivo que existe hoje e não está no backup
    # continua lá — está dito no relatório, para ninguém concluir errado.
    if ! gzip -dc "$FOTOS" | docker exec -i "$container_st" tar -C "$caminho_st" -xf -; then
      FOTOS_DETALHE="o tar falhou ao extrair dentro de $container_st:$caminho_st (a cópia de segurança ficou em $guardado)"
      return 1
    fi
    FOTOS_DETALHE="extraídas em $container_st:$caminho_st, por cima do que já estava lá (cópia do estado anterior em $guardado)"
    jm_log "Fotos restauradas dentro de $container_st. O estado anterior ficou em $guardado."
    return 0
  fi

  FOTOS_DETALHE="nem ${ALVO^^}_DIR_STORAGE nem ${ALVO^^}_CONTAINER_STORAGE estão preenchidos em $ARQUIVO_CONFIG"
  return 1
}

if [ "$COM_FOTOS" != "sim" ]; then
  FOTOS_SITUACAO="pulado"
  FOTOS_DETALHE="--sem-fotos: as fotos não foram pedidas nesta rodada"
  jm_aviso "$FOTOS_DETALHE"
elif [ ! -f "$FOTOS" ]; then
  FOTOS_SITUACAO="sem-arquivo"
  FOTOS_DETALHE="não existe $(basename "$FOTOS") ao lado do dump"
  jm_erro "Este backup não traz o arquivo de fotos: só o banco foi restaurado."
elif restaurar_fotos; then
  FOTOS_SITUACAO="restauradas"
  jm_aviso "Reinicie o contêiner do storage do $ALVO para ele reabrir os arquivos."
else
  FOTOS_SITUACAO="falhou"
  jm_erro "As fotos NÃO voltaram: $FOTOS_DETALHE"
fi

# ---------------------------------------------------------------- conferência

jm_log "Conferindo a contagem das tabelas principais em $ALVO."
CONTAGENS_ALVO="$(mktemp -t jardim-contagens-XXXXXX.tsv)"
jm_contagens "$ALVO" "$TABELAS_CONFERIDAS" > "$CONTAGENS_ALVO"

divergencias=0
linhas_relatorio=""

if [ -f "$MANIFESTO" ]; then
  # join precisa dos dois lados ordenados; o backup já grava ordenado, mas
  # ordenar de novo custa nada e evita surpresa se alguém editar o arquivo.
  relatorio="$(join -t $'\t' -a 1 -a 2 -e '(ausente)' -o '0,1.2,2.2' \
    <(sort -k1,1 "$MANIFESTO") <(sort -k1,1 "$CONTAGENS_ALVO"))"
  if [ -z "$relatorio" ]; then
    jm_erro "Nem o manifesto nem o alvo devolveram tabela nenhuma. Restauração NÃO comprovada."
    exit 3
  fi
  printf '\n%-28s %14s %14s   %s\n' "TABELA" "NO BACKUP" "RESTAURADO" "SITUAÇÃO"
  printf -- '%s\n' "----------------------------------------------------------------------------"
  while IFS=$'\t' read -r tabela origem_n alvo_n; do
    if [ "$origem_n" = "$alvo_n" ]; then
      situacao="ok"
    else
      situacao="DIVERGENTE"
      divergencias=$((divergencias + 1))
    fi
    printf '%-28s %14s %14s   %s\n' "$tabela" "$origem_n" "$alvo_n" "$situacao"
    linhas_relatorio="${linhas_relatorio}| \`${tabela}\` | ${origem_n} | ${alvo_n} | ${situacao} |
"
  done <<< "$relatorio"
  printf -- '%s\n' "----------------------------------------------------------------------------"
else
  jm_aviso "Sem manifesto de contagens ao lado do dump ($MANIFESTO)."
  jm_aviso "Dá para ver o que foi restaurado, mas não dá para provar que bate com a origem."
  printf '\n%-28s %14s\n' "TABELA" "RESTAURADO"
  sed 's/\t/  /' "$CONTAGENS_ALVO" | awk '{printf "%-28s %14s\n", $1, $2}'
  divergencias=-1
fi

DURACAO=$(( $(date +%s) - INICIO ))

# ---------------------------------------------------------------- resultado

# Fotos que não voltaram derrubam o veredito, e não viram um aviso no stderr que
# ninguém lê: restauração sem as fotos é meia restauração, e o cardápio volta com
# todas as imagens quebradas. Só --sem-fotos, que é escolha explícita de quem
# rodou, permite dizer "conferida" sem elas.
if [ "$FOTOS_SITUACAO" = "restauradas" ] || [ "$FOTOS_SITUACAO" = "pulado" ]; then
  fotos_ok="sim"
else
  fotos_ok="nao"
fi

if [ "$divergencias" -lt 0 ]; then
  resultado="RESTAURAÇÃO EXECUTADA, SEM CONFERÊNCIA: faltou o manifesto de contagens."
elif [ "$divergencias" -gt 0 ]; then
  resultado="RESTAURAÇÃO COM DIVERGÊNCIA: $divergencias tabela(s) não bateram."
elif [ "$fotos_ok" = "nao" ]; then
  resultado="RESTAURAÇÃO PARCIAL: só o banco. As tabelas bateram, mas as FOTOS não voltaram."
elif [ "$FOTOS_SITUACAO" = "pulado" ]; then
  resultado="RESTAURAÇÃO CONFERIDA (só o banco, --sem-fotos): todas as tabelas bateram com o backup."
else
  resultado="RESTAURAÇÃO CONFERIDA: banco e fotos voltaram, e todas as tabelas bateram com o backup."
fi

cat <<FIM

$resultado
Fotos: ${FOTOS_SITUACAO} — ${FOTOS_DETALHE}
Tempo total: ${DURACAO}s (esse é o número que vai no registro de QA como tempo de recuperação).
Registro do pg_restore: $REGISTRO
Contagens do alvo: $CONTAGENS_ALVO

------------------------------------------------------------------
Cole no registro docs/qa/restauracao-${DATA_DIA}.md:

- Data: ${DATA_DIA}
- Arquivo restaurado: $(basename "$ARQUIVO")  (${ITENS_INDICE} itens no índice)
- Origem: ${ORIGEM} · Alvo: ${ALVO} (${DESTINO_LEGIVEL})
- Tempo até o banco de pé: ${DURACAO}s
- Linhas de erro no pg_restore: ${erros_ignorados}
- Fotos do Storage: ${FOTOS_SITUACAO} — ${FOTOS_DETALHE}
- Resultado: ${resultado}

| Tabela | No backup | Restaurado | Situação |
|---|---:|---:|---|
${linhas_relatorio}
------------------------------------------------------------------
FIM

if [ "$COM_AVISO" = "sim" ]; then
  jm_telegram "$(printf '%s\n' \
    "Jardim Menu — teste de restauração (${DATA_DIA})" \
    "${ORIGEM} -> ${ALVO}, arquivo $(basename "$ARQUIVO")" \
    "${resultado}" \
    "Fotos: ${FOTOS_SITUACAO}" \
    "Tempo: ${DURACAO}s · erros no pg_restore: ${erros_ignorados}" \
    "Registre em docs/qa/restauracao-${DATA_DIA}.md (NF-011).")"
fi

[ "$divergencias" -gt 0 ] && exit 3
[ "$fotos_ok" = "nao" ] && exit 3
exit 0
