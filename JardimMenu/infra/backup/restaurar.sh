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
# Ele pega o dump mais recente de produção, restaura no staging, confere a
# contagem das tabelas principais contra o manifesto gravado na hora do backup
# e imprime o resultado já no formato do registro de QA.
#
# Restaurar EM PRODUÇÃO é recusado por padrão. Só acontece com a opção
# --confirmo-producao mais duas respostas digitadas à mão, porque restaurar por
# cima da produção apaga o que aconteceu desde o backup: é operação de
# desastre, não de rotina.
#
# Uso:
#   restaurar.sh [--de producao] [--para staging] [--arquivo CAMINHO]
#                [--do-remoto] [--tudo] [--sem-fotos] [--sem-aviso]
#                [--config CAMINHO] [--confirmo-producao]

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
    --confirmo-producao) CONFIRMA_PRODUCAO="sim"; shift ;;
    -h|--help) sed -n '2,26p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) jm_erro "Opção desconhecida: $1"; exit 2 ;;
  esac
done

jm_carregar_config "$ARQUIVO_CONFIG"

DIR_BACKUP="${DIR_BACKUP:-/var/backups/jardim-menu}"
TABELAS_CONFERIDAS="${TABELAS_CONFERIDAS:-stores store_users categories products option_groups options product_option_groups tables devices table_sessions table_tabs orders order_items menu_events}"
ESQUEMAS_RESTAURACAO="${ESQUEMAS_RESTAURACAO:-public auth storage}"
RCLONE_REMOTO="${RCLONE_REMOTO:-}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/jardim-menu/rclone.conf}"

jm_validar_ambiente "$ORIGEM"
jm_validar_ambiente "$ALVO"
jm_exige_comandos awk sort date

INICIO="$(date +%s)"
DATA_DIA="$(date '+%Y-%m-%d')"

# ---------------------------------------------------------------- a trava

# A recusa é explícita: o alvo padrão é o staging, e produção só com dupla
# confirmação. Restaurar em produção sobrescreve tudo que foi pedido desde o
# backup, e no piloto isso é pedido de cliente que some.
if [ "$ALVO" = "producao" ]; then
  jm_erro "PEDIDO DE RESTAURAÇÃO EM PRODUÇÃO."
  jm_erro "Isso apaga tudo que entrou no banco depois do backup escolhido."
  jm_erro "Se o que você quer é TESTAR o backup, rode sem argumento nenhum: o alvo padrão é o staging."
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

# ---------------------------------------------------------------- o arquivo

baixar_do_remoto() {
  local origem="$1" destino_dir="$2"
  [ -n "$RCLONE_REMOTO" ] || { jm_erro "RCLONE_REMOTO vazio: não há de onde baixar."; return 1; }
  jm_exige_comandos rclone || return 1

  local nome
  # O nome do arquivo começa com a data em ISO, então ordem alfabética é ordem
  # cronológica: o último da lista é o mais recente.
  nome="$(rclone --config "$RCLONE_CONFIG" lsf "$RCLONE_REMOTO/$origem" --include '*.dump' | sort | tail -n 1)"
  [ -n "$nome" ] || { jm_erro "Nenhum .dump encontrado em $RCLONE_REMOTO/$origem"; return 1; }

  mkdir -p "$destino_dir"
  jm_log "Baixando $nome do destino externo"
  rclone --config "$RCLONE_CONFIG" copyto "$RCLONE_REMOTO/$origem/$nome" "$destino_dir/$nome"
  # O manifesto de contagens vem junto: sem ele não há o que conferir.
  rclone --config "$RCLONE_CONFIG" copyto \
    "$RCLONE_REMOTO/$origem/${nome%.dump}.contagens.tsv" \
    "$destino_dir/${nome%.dump}.contagens.tsv" 2>/dev/null \
    || jm_aviso "Não achei o manifesto de contagens no destino externo."
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

# ---------------------------------------------------------------- o aviso na tela

container_alvo="$(jm_var_ambiente "$ALVO" CONTAINER_DB "(host)")"
banco_alvo="$(jm_var_ambiente "$ALVO" PG_DB "${PG_DB:-postgres}")"

cat <<FIM
------------------------------------------------------------------
 RESTAURAÇÃO DO JARDIM MENU
   de   : $ORIGEM
   para : $ALVO   (contêiner $container_alvo, banco $banco_alvo)
   dump : $(basename "$ARQUIVO")  ($(jm_tamanho "$ARQUIVO"))
   feito em: $(date -r "$ARQUIVO" '+%Y-%m-%d %H:%M' 2>/dev/null || echo 'data desconhecida')
   fotos: $( [ -f "$FOTOS" ] && echo "$(basename "$FOTOS") ($(jm_tamanho "$FOTOS"))" || echo 'sem arquivo de fotos neste backup' )
   esquemas: $( [ "$TUDO" = "sim" ] && echo 'todos' || echo "$ESQUEMAS_RESTAURACAO" )
------------------------------------------------------------------
FIM

if [ "$ALVO" = "producao" ]; then
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
fi

# ---------------------------------------------------------------- restaurar

modo="$(jm_var_ambiente "$ALVO" MODO_BANCO "${MODO_BANCO:-docker}")"
# supabase_admin: os schemas auth e storage pertencem a ele. Como `postgres`, o pg_restore
# leva "permission denied for schema auth" em cada objeto dos dois, e a restauração volta
# sem as contas da equipe e sem o registro das fotos (achado de 23/09/2026).
user="$(jm_var_ambiente "$ALVO" PG_USER "${PG_USER:-supabase_admin}")"
senha="$(jm_var_ambiente "$ALVO" PG_SENHA "")"
host="$(jm_var_ambiente "$ALVO" PG_HOST "127.0.0.1")"
porta="$(jm_var_ambiente "$ALVO" PG_PORTA "5432")"

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

if [ "$COM_FOTOS" = "sim" ] && [ -f "$FOTOS" ]; then
  dir_alvo="$(jm_var_ambiente "$ALVO" DIR_STORAGE "")"
  if [ -n "$dir_alvo" ]; then
    guardado="${dir_alvo}.antes-de-${DATA_DIA}-$(date +%H%M)"
    jm_log "Guardando as fotos atuais de $ALVO em $guardado e extraindo as do backup."
    if [ -d "$dir_alvo" ]; then
      mv "$dir_alvo" "$guardado"
    fi
    mkdir -p "$dir_alvo"
    tar -C "$dir_alvo" -xzf "$FOTOS"
    jm_log "Fotos restauradas em $dir_alvo. A pasta antiga ficou em $guardado (apague depois de conferir)."
    jm_aviso "Reinicie o contêiner do storage do $ALVO para ele reabrir os arquivos."
  else
    jm_aviso "${ALVO^^}_DIR_STORAGE não configurado: as fotos não foram restauradas."
    jm_aviso "Se o storage do $ALVO usa volume do Docker, extraia à mão (BACKUP.md explica)."
  fi
elif [ "$COM_FOTOS" = "sim" ]; then
  jm_aviso "Este backup não tem arquivo de fotos; só o banco foi restaurado."
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

if [ "$divergencias" -eq 0 ]; then
  resultado="RESTAURAÇÃO CONFERIDA: todas as tabelas bateram com o backup."
elif [ "$divergencias" -lt 0 ]; then
  resultado="RESTAURAÇÃO EXECUTADA, SEM CONFERÊNCIA: faltou o manifesto de contagens."
else
  resultado="RESTAURAÇÃO COM DIVERGÊNCIA: $divergencias tabela(s) não bateram."
fi

cat <<FIM

$resultado
Tempo total: ${DURACAO}s (esse é o número que vai no registro de QA como tempo de recuperação).
Registro do pg_restore: $REGISTRO
Contagens do alvo: $CONTAGENS_ALVO

------------------------------------------------------------------
Cole no registro docs/qa/restauracao-${DATA_DIA}.md:

- Data: ${DATA_DIA}
- Arquivo restaurado: $(basename "$ARQUIVO")
- Origem: ${ORIGEM} · Alvo: ${ALVO}
- Tempo até o banco de pé: ${DURACAO}s
- Linhas de erro no pg_restore: ${erros_ignorados}
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
    "Tempo: ${DURACAO}s · erros no pg_restore: ${erros_ignorados}" \
    "Registre em docs/qa/restauracao-${DATA_DIA}.md (NF-011).")"
fi

[ "$divergencias" -gt 0 ] && exit 3
exit 0
