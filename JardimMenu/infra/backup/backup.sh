#!/usr/bin/env bash
#
# Backup diário do Jardim Menu (NF-011: backup automático diário, com
# restauração testada e registrada antes da primeira subida).
#
# O que ele guarda, por ambiente:
#   1. o banco inteiro, em formato custom do pg_dump (-Fc), que é o formato que
#      o pg_restore consegue restaurar por partes e conferir sem restaurar;
#   2. os papéis do cluster (pg_dumpall --globals-only), pequenos e úteis quando
#      o Supabase é reinstalado do zero;
#   3. as fotos do Storage (bucket `produtos`), em tar.gz. Foto perdida é
#      trabalho do gestor perdido, e ela não está dentro do dump do banco;
#   4. um manifesto com a contagem das tabelas principais no momento do dump.
#      É contra esse número que a restauração se confere: sem ele, dizer que a
#      restauração deu certo é opinião.
#
# Depois guarda cópia FORA do servidor com rclone, apaga o que passou da
# retenção local e avisa no Telegram: sempre que falha, e uma vez por semana
# quando dá certo.
#
# Uso:
#   backup.sh [--ambiente NOME] [--somente-banco] [--sem-remoto]
#             [--config CAMINHO] [--simular]
#
# Roda sozinho pelo timer do systemd (systemd/jardim-backup.timer). A alternativa
# em cron está no README.md desta pasta.

set -euo pipefail

DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/comum.sh
. "$DIR_SCRIPT/lib/comum.sh"

ARQUIVO_CONFIG="${JARDIM_BACKUP_ENV:-/etc/jardim-menu/backup.env}"
AMBIENTE_UNICO=""
SOMENTE_BANCO="nao"
SEM_REMOTO="nao"
SIMULAR="nao"

while [ $# -gt 0 ]; do
  case "$1" in
    --ambiente) AMBIENTE_UNICO="${2:-}"; shift 2 ;;
    --config) ARQUIVO_CONFIG="${2:-}"; shift 2 ;;
    --somente-banco) SOMENTE_BANCO="sim"; shift ;;
    --sem-remoto) SEM_REMOTO="sim"; shift ;;
    --simular) SIMULAR="sim"; shift ;;
    -h|--help) sed -n '2,27p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) jm_erro "Opção desconhecida: $1"; exit 2 ;;
  esac
done

jm_carregar_config "$ARQUIVO_CONFIG"

AMBIENTES="${AMBIENTES:-producao staging}"
[ -n "$AMBIENTE_UNICO" ] && AMBIENTES="$AMBIENTE_UNICO"

DIR_BACKUP="${DIR_BACKUP:-/var/backups/jardim-menu}"
DIR_TRAVA="${DIR_TRAVA:-/var/lock}"
DIAS_RETENCAO_LOCAL="${DIAS_RETENCAO_LOCAL:-14}"
DIAS_RETENCAO_REMOTO="${DIAS_RETENCAO_REMOTO:-0}"
DIAS_ENTRE_RESUMOS="${DIAS_ENTRE_RESUMOS:-7}"
# auth.users e storage.objects entram com o schema na frente, e não por capricho: são as
# contas da equipe e o registro das fotos, moram fora do public, e foram exatamente o que
# um backup aparentemente bom deixou de fora em 23/09/2026. Contadas aqui, a restauração
# compara e não tem como declarar "conferida" sem elas.
TABELAS_CONFERIDAS="${TABELAS_CONFERIDAS:-stores store_users categories products option_groups options product_option_groups tables devices table_sessions table_tabs orders order_items menu_events auth.users storage.objects}"
DUMP_GLOBAIS="${DUMP_GLOBAIS:-sim}"
RCLONE_REMOTO="${RCLONE_REMOTO:-}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/jardim-menu/rclone.conf}"
RCLONE_OPCOES="${RCLONE_OPCOES:---transfers 4 --retries 3 --low-level-retries 10}"

jm_exige_comandos curl tar find date awk flock sha256sum

mkdir -p "$DIR_BACKUP" "$DIR_TRAVA"

# Uma rodada de cada vez. Se a de ontem ainda estiver rodando (dump grande,
# rede ruim), a de hoje sai sem fazer nada; duas ao mesmo tempo só brigariam
# por disco e por banda.
exec 9>"$DIR_TRAVA/jardim-backup.lock"
if ! flock -n 9; then
  jm_aviso "Outro backup ainda está rodando. Saindo sem fazer nada."
  exit 0
fi

DATA_HORA="$(date '+%Y-%m-%dT%H%M')"
DATA_DIA="$(date '+%Y-%m-%d')"
REGISTRO_RODADA="$(mktemp -t jardim-backup-XXXXXX.log)"
trap 'rm -f "$REGISTRO_RODADA"' EXIT

# Tudo que os passos imprimem vai para o registro da rodada e para a saída
# padrão (que o journald recolhe). O fim do registro é o que vai no aviso de
# falha: quem recebe o alerta no celular precisa ver o erro, não só "falhou".
exec > >(tee -a "$REGISTRO_RODADA") 2>&1

FALHAS=""
RESUMO=""

# --------------------------------------------------------------- passos

executar() {
  if [ "$SIMULAR" = "sim" ]; then
    jm_log "SIMULAÇÃO: $*"
    return 0
  fi
  "$@"
}

# Dump do banco em formato custom. O -Fc é o que o NF-011 pede na prática: dá
# para restaurar por partes e para listar o conteúdo sem restaurar nada.
dump_banco() {
  local ambiente="$1" destino="$2"
  local modo container user db host porta senha parcial
  modo="$(jm_var_ambiente "$ambiente" MODO_BANCO "${MODO_BANCO:-docker}")"
  user="$(jm_var_ambiente "$ambiente" PG_USER "${PG_USER:-supabase_admin}")"
  db="$(jm_var_ambiente "$ambiente" PG_DB "${PG_DB:-postgres}")"
  senha="$(jm_var_ambiente "$ambiente" PG_SENHA "")"
  container="$(jm_var_ambiente "$ambiente" CONTAINER_DB "")"
  host="$(jm_var_ambiente "$ambiente" PG_HOST "127.0.0.1")"
  porta="$(jm_var_ambiente "$ambiente" PG_PORTA "5432")"
  parcial="${destino}.parcial"

  jm_log "[$ambiente] pg_dump -Fc para $(basename "$destino")"
  if [ "$SIMULAR" = "sim" ]; then
    jm_log "SIMULAÇÃO: pg_dump de $ambiente"
    return 0
  fi

  if [ "$modo" = "docker" ]; then
    [ -n "$container" ] || { jm_erro "[$ambiente] falta ${ambiente^^}_CONTAINER_DB na configuração."; return 1; }
    # O cliente usado é o da própria imagem do Postgres 17.6, o que elimina
    # divergência de versão entre cliente do host e servidor.
    docker exec -i -e PGPASSWORD="$senha" "$container" \
      pg_dump -U "$user" -d "$db" -Fc -Z 6 > "$parcial" \
      || { rm -f "$parcial"; jm_erro "[$ambiente] pg_dump falhou."; return 1; }
  else
    PGPASSWORD="$senha" pg_dump -h "$host" -p "$porta" -U "$user" -d "$db" -Fc -Z 6 > "$parcial" \
      || { rm -f "$parcial"; jm_erro "[$ambiente] pg_dump falhou."; return 1; }
  fi

  # Só vira arquivo definitivo depois de o pg_restore conseguir ler o índice.
  # Dump truncado que ninguém abriu é o clássico do backup que não existe.
  local indice
  if [ "$modo" = "docker" ]; then
    indice="$(docker exec -i "$container" pg_restore --list < "$parcial" 2>/dev/null)" \
      || { rm -f "$parcial"; jm_erro "[$ambiente] o dump não passou no pg_restore --list: arquivo inválido."; return 1; }
  else
    indice="$(pg_restore --list "$parcial" 2>/dev/null)" \
      || { rm -f "$parcial"; jm_erro "[$ambiente] o dump não passou no pg_restore --list: arquivo inválido."; return 1; }
  fi

  # O dump PRECISA trazer auth.users e storage.objects. Ler o índice é o único jeito de
  # saber: quando o pg_dump roda com um papel que não enxerga esses schemas, ele não
  # falha, não avisa e devolve código 0 — só entrega um dump sem eles.
  #
  # Foi o que aconteceu em 23/09/2026, com PG_USER=postgres: o backup parecia perfeito, a
  # restauração no staging bateu todas as contagens do `public` e declarou "CONFERIDA", e
  # o garçom apagado não voltou. Num desastre de verdade, o cardápio voltaria e ninguém
  # da equipe conseguiria entrar.
  # Casamento em bash puro, sem cano. `printf ... | grep -q` não serve aqui: o grep -q sai
  # no primeiro acerto, o printf morre de SIGPIPE, e com `set -o pipefail` o pipeline
  # inteiro vira falha — ou seja, encontrar a tabela era registrado como não encontrar.
  local faltando=""
  case "$indice" in *"TABLE DATA auth users"*) ;; *) faltando="$faltando auth.users" ;; esac
  case "$indice" in *"TABLE DATA storage objects"*) ;; *) faltando="$faltando storage.objects" ;; esac
  if [ -n "$faltando" ]; then
    rm -f "$parcial"
    jm_erro "[$ambiente] o dump saiu SEM:$faltando. Quase sempre é o papel do banco: ${ambiente^^}_PG_USER precisa ser supabase_admin, que é o dono dos schemas auth e storage. Com 'postgres' o pg_dump omite os dois sem reclamar."
    return 1
  fi

  mv "$parcial" "$destino"
  jm_log "[$ambiente] dump pronto: $(jm_tamanho "$destino")"
}

# Papéis e privilégios do cluster. Pequeno, e é o que falta quando alguém
# reinstala o Supabase do zero e o restore reclama de role inexistente.
dump_globais() {
  local ambiente="$1" destino="$2"
  local modo container user senha host porta
  modo="$(jm_var_ambiente "$ambiente" MODO_BANCO "${MODO_BANCO:-docker}")"
  user="$(jm_var_ambiente "$ambiente" PG_USER "${PG_USER:-supabase_admin}")"
  senha="$(jm_var_ambiente "$ambiente" PG_SENHA "")"
  container="$(jm_var_ambiente "$ambiente" CONTAINER_DB "")"
  host="$(jm_var_ambiente "$ambiente" PG_HOST "127.0.0.1")"
  porta="$(jm_var_ambiente "$ambiente" PG_PORTA "5432")"

  jm_log "[$ambiente] pg_dumpall --globals-only"
  if [ "$SIMULAR" = "sim" ]; then return 0; fi

  if [ "$modo" = "docker" ]; then
    docker exec -i -e PGPASSWORD="$senha" "$container" \
      pg_dumpall -U "$user" --globals-only | gzip -6 > "${destino}.parcial"
  else
    PGPASSWORD="$senha" pg_dumpall -h "$host" -p "$porta" -U "$user" --globals-only \
      | gzip -6 > "${destino}.parcial"
  fi
  mv "${destino}.parcial" "$destino"
}

# Fotos do Storage. Dois caminhos, porque ainda não sabemos como a frente de
# infraestrutura vai montar o volume:
#  - <AMB>_DIR_STORAGE: caminho no host (o volume montado). Mais simples.
#  - <AMB>_CONTAINER_STORAGE + <AMB>_CAMINHO_STORAGE: tar de dentro do contêiner.
dump_storage() {
  local ambiente="$1" destino="$2"
  local dir container caminho
  dir="$(jm_var_ambiente "$ambiente" DIR_STORAGE "")"
  container="$(jm_var_ambiente "$ambiente" CONTAINER_STORAGE "")"
  caminho="$(jm_var_ambiente "$ambiente" CAMINHO_STORAGE "/var/lib/storage")"

  if [ -n "$dir" ] && [ -d "$dir" ]; then
    jm_log "[$ambiente] fotos do Storage a partir do host: $dir"
    if [ "$SIMULAR" = "sim" ]; then return 0; fi
    tar -C "$dir" -czf "${destino}.parcial" . \
      || { rm -f "${destino}.parcial"; return 1; }
  elif [ -n "$container" ]; then
    jm_log "[$ambiente] fotos do Storage de dentro do contêiner $container:$caminho"
    if [ "$SIMULAR" = "sim" ]; then return 0; fi
    docker exec -i "$container" tar -C "$caminho" -cf - . | gzip -6 > "${destino}.parcial" \
      || { rm -f "${destino}.parcial"; return 1; }
  else
    jm_aviso "[$ambiente] Storage não configurado (${ambiente^^}_DIR_STORAGE ou ${ambiente^^}_CONTAINER_STORAGE). As fotos NÃO entraram neste backup."
    return 0
  fi

  mv "${destino}.parcial" "$destino"
  jm_log "[$ambiente] fotos guardadas: $(jm_tamanho "$destino")"
}

# Manifesto: contagem das tabelas principais no instante do dump. A restauração
# compara contra este arquivo, e é isso que transforma "restaurei" em prova.
manifesto_contagens() {
  local ambiente="$1" destino="$2"
  jm_log "[$ambiente] contando as tabelas principais"
  if [ "$SIMULAR" = "sim" ]; then return 0; fi
  jm_contagens "$ambiente" "$TABELAS_CONFERIDAS" > "${destino}.parcial" \
    || { rm -f "${destino}.parcial"; return 1; }
  mv "${destino}.parcial" "$destino"
  sed 's/^/    /' "$destino"
}

# Cópia para fora do servidor. Backup que só existe no servidor não protege
# contra a perda do servidor: o NF-011 só está atendido com esta cópia de pé.
enviar_para_fora() {
  local ambiente="$1"; shift
  local arquivo
  if [ "$SEM_REMOTO" = "sim" ]; then
    jm_log "[$ambiente] --sem-remoto: cópia externa pulada (use só em teste)."
    return 0
  fi
  if [ -z "$RCLONE_REMOTO" ]; then
    jm_erro "[$ambiente] RCLONE_REMOTO vazio: a cópia FORA do servidor não aconteceu."
    return 1
  fi
  jm_exige_comandos rclone || return 1

  for arquivo in "$@"; do
    [ -f "$arquivo" ] || continue
    jm_log "[$ambiente] enviando $(basename "$arquivo") para $RCLONE_REMOTO/$ambiente/"
    # shellcheck disable=SC2086
    executar rclone --config "$RCLONE_CONFIG" $RCLONE_OPCOES \
      copyto "$arquivo" "$RCLONE_REMOTO/$ambiente/$(basename "$arquivo")" || return 1
  done

  case "$DIAS_RETENCAO_REMOTO" in
    ''|*[!0-9]*) ;;
    0) ;;
    *)
      jm_log "[$ambiente] apagando no destino externo o que passou de ${DIAS_RETENCAO_REMOTO} dias"
      # shellcheck disable=SC2086
      executar rclone --config "$RCLONE_CONFIG" $RCLONE_OPCOES \
        delete --min-age "${DIAS_RETENCAO_REMOTO}d" "$RCLONE_REMOTO/$ambiente" \
        || jm_aviso "[$ambiente] a limpeza do destino externo falhou; os arquivos novos já subiram."
      ;;
  esac
}

# Retenção local. Mantemos DIAS_RETENCAO_LOCAL dias no servidor; o histórico
# longo fica no destino externo (ou na regra de ciclo de vida do bucket, que é
# o lugar mais seguro para isso).
limpar_antigos() {
  local ambiente="$1" dir="$2"
  jm_log "[$ambiente] apagando backups locais com mais de ${DIAS_RETENCAO_LOCAL} dias"
  executar find "$dir" -maxdepth 1 -type f -name 'jardim-*' \
    -mtime "+${DIAS_RETENCAO_LOCAL}" -print -delete
}

# --------------------------------------------------------------- rodada

for ambiente in $AMBIENTES; do
  if ! jm_validar_ambiente "$ambiente"; then
    FALHAS="$FALHAS ${ambiente}(nome inválido)"
    continue
  fi

  dir_amb="$DIR_BACKUP/$ambiente"
  mkdir -p "$dir_amb"
  chmod 700 "$dir_amb" 2>/dev/null || true

  base="$dir_amb/jardim-${ambiente}-${DATA_HORA}"
  arq_dump="${base}.dump"
  arq_globais="${base}.globais.sql.gz"
  arq_storage="${base}.storage.tar.gz"
  arq_contagens="${base}.contagens.tsv"
  arq_soma="${base}.sha256"

  jm_log "=== [$ambiente] início da rodada de ${DATA_DIA} ==="
  erro_ambiente=""
  gerados=()

  if dump_banco "$ambiente" "$arq_dump"; then
    gerados+=("$arq_dump")
  else
    erro_ambiente="pg_dump"
  fi

  if [ -z "$erro_ambiente" ]; then
    if manifesto_contagens "$ambiente" "$arq_contagens"; then
      gerados+=("$arq_contagens")
    else
      erro_ambiente="contagem das tabelas"
    fi
  fi

  if [ -z "$erro_ambiente" ] && [ "$DUMP_GLOBAIS" = "sim" ]; then
    if dump_globais "$ambiente" "$arq_globais"; then
      gerados+=("$arq_globais")
    else
      jm_aviso "[$ambiente] pg_dumpall dos papéis falhou; o dump do banco continua de pé."
    fi
  fi

  if [ -z "$erro_ambiente" ] && [ "$SOMENTE_BANCO" = "nao" ]; then
    if dump_storage "$ambiente" "$arq_storage"; then
      [ -f "$arq_storage" ] && gerados+=("$arq_storage")
    else
      erro_ambiente="fotos do Storage"
    fi
  fi

  # Soma de verificação: é com ela que se descobre, meses depois, que o arquivo
  # mudou entre o servidor e o destino externo.
  if [ -z "$erro_ambiente" ] && [ "$SIMULAR" = "nao" ] && [ "${#gerados[@]}" -gt 0 ]; then
    nomes=()
    for arquivo_gerado in "${gerados[@]}"; do
      nomes+=("$(basename "$arquivo_gerado")")
    done
    if ( cd "$dir_amb" && sha256sum "${nomes[@]}" > "$arq_soma" ); then
      gerados+=("$arq_soma")
    else
      jm_aviso "[$ambiente] não consegui gerar o sha256."
    fi
  fi

  if [ -z "$erro_ambiente" ]; then
    if ! enviar_para_fora "$ambiente" "${gerados[@]}"; then
      erro_ambiente="cópia para fora do servidor"
    fi
  fi

  limpar_antigos "$ambiente" "$dir_amb" || jm_aviso "[$ambiente] a limpeza dos antigos falhou."

  if [ -n "$erro_ambiente" ]; then
    jm_erro "[$ambiente] rodada FALHOU em: $erro_ambiente"
    FALHAS="$FALHAS ${ambiente}(${erro_ambiente})"
  else
    linhas_total="$(awk -F'\t' '{s+=$2} END {print s+0}' "$arq_contagens" 2>/dev/null || echo '?')"
    RESUMO="${RESUMO}
• ${ambiente}: banco $(jm_tamanho "$arq_dump"), fotos $(jm_tamanho "$arq_storage"), ${linhas_total} linhas nas tabelas conferidas"
    jm_log "=== [$ambiente] rodada concluída ==="
  fi
done

# --------------------------------------------------------------- avisos

disco_livre="$(df -Ph "$DIR_BACKUP" | awk 'NR==2 {print $4" livres de "$2" ("$5" usado)"}')"

if [ -n "$FALHAS" ]; then
  trecho="$(tail -n 25 "$REGISTRO_RODADA")"
  jm_telegram "$(printf '%s\n' \
    "Jardim Menu — BACKUP FALHOU (${DATA_DIA})" \
    "Ambiente(s):${FALHAS}" \
    "Disco do backup: ${disco_livre}" \
    "" \
    "Fim do registro da rodada:" \
    "${trecho}" \
    "" \
    "O que fazer: docs/operacao/BACKUP.md, seção 'Quando chega o aviso de falha'.")"
  exit 1
fi

# Sucesso não enche o canal todo dia. Uma vez por semana o aviso confirma que a
# rotina está viva: silêncio total também é jeito de um backup morrer sem
# ninguém perceber.
marca="$(jm_dir_estado)/ultimo-resumo"
enviar_resumo="sim"
if [ -f "$marca" ]; then
  idade_dias=$(( ( $(date +%s) - $(stat -c %Y "$marca") ) / 86400 ))
  [ "$idade_dias" -lt "$DIAS_ENTRE_RESUMOS" ] && enviar_resumo="nao"
fi

if [ "$enviar_resumo" = "sim" ]; then
  jm_telegram "$(printf '%s\n' \
    "Jardim Menu — backup em dia (${DATA_DIA})" \
    "Última rodada:${RESUMO}" \
    "" \
    "Disco do backup: ${disco_livre}" \
    "Retenção local: ${DIAS_RETENCAO_LOCAL} dias · cópia externa: ${RCLONE_REMOTO:-NÃO CONFIGURADA}" \
    "Lembrete do NF-011: a restauração de teste se repete antes de cada fase que migra o banco.")"
  date > "$marca"
fi

jm_log "Backup concluído sem falhas. Disco: $disco_livre"
exit 0
