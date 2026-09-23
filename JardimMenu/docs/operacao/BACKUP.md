# Backup: como funciona, e como saber que funciona

Atende o **NF-011**: backup diário automático, com **ao menos uma restauração
completa executada e registrada antes da primeira subida a produção**, repetida
antes de cada fase que mexe no banco.

A frase que importa é "restauração testada". Backup que nunca foi restaurado é
uma pasta de arquivos com nome bonito: ninguém sabe se presta até precisar, e
precisar é justamente a hora errada de descobrir.

---

## O que é guardado, todo dia às 5h

| O quê | Formato | Por quê |
|---|---|---|
| O banco inteiro de cada ambiente | `pg_dump` custom (`.dump`) | É o cardápio, as mesas, os dispositivos e os pedidos |
| Os papéis do servidor de banco | `.globais.sql.gz` | É o que falta quando o Supabase é reinstalado do zero |
| As fotos dos produtos | `.storage.tar.gz` | As fotos **não** estão dentro do banco. O banco guarda o caminho; o arquivo está em disco |
| A contagem de cada tabela | `.contagens.tsv` | É o número que a restauração confere depois |
| A soma de verificação | `.sha256` | Descobre arquivo corrompido no caminho |

Às 5h porque a casa está fechada e ninguém está pedindo. O servidor fica no
fuso de Brasília, que é o fuso da operação.

Antes de aceitar um arquivo como bom, o script tenta abri-lo. Arquivo que não
abre não é guardado, e a falha vira aviso na mesma hora.

## Onde ficam

- **No servidor:** `/var/backups/jardim-menu/<ambiente>/`, os últimos 14 dias.
- **Fora do servidor:** enviados por `rclone` para o destino contratado
  (Backblaze B2, S3 ou Google Drive, o que estiver configurado).

Os dois lugares importam por motivos diferentes. A cópia local resolve "alguém
apagou o cardápio por engano" em dois minutos. A cópia externa resolve "o
servidor morreu", e é a única que resolve — backup que só existe no servidor
não protege contra a perda do servidor.

## Os avisos no Telegram

| Quando | Mensagem |
|---|---|
| Toda vez que falha | "BACKUP FALHOU", com o ambiente, o passo e o fim do registro |
| Uma vez por semana, dando certo | "backup em dia", com os tamanhos e o total de linhas |

O aviso semanal existe porque silêncio não é sinal de saúde: uma rotina que
morreu também fica em silêncio. Se passar mais de uma semana sem nenhuma das
duas mensagens, **o monitoramento do backup é que parou**, e isso se investiga.

---

## Testar a restauração

O teste é sempre o mesmo: pegar o backup de **produção** e restaurá-lo no
**staging**.

```bash
sudo /opt/jardim-menu/JardimMenu/infra/backup/restaurar.sh
```

O script pega o dump mais recente de produção, restaura no staging, compara
tabela a tabela com a contagem gravada na hora do backup e imprime:

```
TABELA                            NO BACKUP     RESTAURADO   SITUAÇÃO
products                                 47             47   ok
orders                                  312            312   ok
```

No fim, ele imprime um bloco pronto para colar no registro de QA.

Para provar que a **cópia externa** também presta — é ela que salva no dia em
que o servidor some — repita buscando lá fora:

```bash
sudo /opt/jardim-menu/JardimMenu/infra/backup/restaurar.sh --do-remoto
```

### Registrar

Toda restauração de teste vira um arquivo:

```
docs/qa/restauracao-AAAA-MM-DD.md
```

Comece pelo modelo `docs/qa/restauracao-AAAA-MM-DD.md`, copie-o com a data do
dia no nome e preencha. O modelo explica cada campo. **Restauração sem registro
não conta para o NF-011**: o requisito pede o registro, não só o ato.

### Com que frequência

| Quando | Obrigatório? |
|---|---|
| Antes da primeira subida a produção (fim da Fase B) | Sim, é o NF-011 |
| Antes de cada fase que mexe no banco | Sim, é o NF-011 |
| Uma vez por mês, no staging | Recomendado. Custa 15 minutos |
| Depois de trocar o destino externo | Sim. Destino novo é destino não testado |
| Depois de mudar a versão do Postgres | Sim, sem exceção |

---

## Quando chega o aviso de falha

A mensagem diz o ambiente e em que passo parou. Comece pelo registro completo:

```bash
journalctl -u jardim-backup.service -n 100 --no-pager
```

| O que a mensagem diz | O que costuma ser | O que fazer |
|---|---|---|
| falhou em `pg_dump` | O contêiner do banco não está de pé, ou o nome dele mudou | `docker ps` e compare com `<AMBIENTE>_CONTAINER_DB` em `/etc/jardim-menu/backup.env` |
| falhou em `contagem das tabelas` | O dump saiu, mas o banco não respondeu depois | Veja se o Postgres está aceitando conexão; pode ser disco cheio |
| falhou em `cópia para fora do servidor` | Credencial do rclone vencida, cota estourada ou rede | `rclone --config /etc/jardim-menu/rclone.conf lsd <remoto>:` |
| falhou em `fotos do Storage` | O caminho do volume mudou | `docker inspect` do contêiner do storage e conferir `<AMBIENTE>_DIR_STORAGE` |
| `o dump não passou no pg_restore --list` | Disco cheio no meio do dump | `df -h`, liberar espaço e rodar à mão |

Depois de arrumar, rode uma vez à mão em vez de esperar o dia seguinte:

```bash
sudo systemctl start jardim-backup.service
journalctl -u jardim-backup.service -f
```

**Backup que falhou dois dias seguidos deixa de ser aviso e vira emergência.**
Nesse ponto, a casa está operando sem rede de segurança.

---

## Perguntas que aparecem

**"Apaguei um produto sem querer. Dá para voltar só ele?"**
Dá, e não se faz isso restaurando por cima da produção. Restaure o backup no
staging, olhe lá o que o produto tinha e recadastre à mão no admin. Restaurar
produção inteira por causa de um produto apaga tudo que aconteceu depois.

**"Quanto tempo leva uma restauração?"**
No piloto, minutos. O número de verdade é o que o script imprime ao fim de cada
teste, e é por isso que ele entra no registro de QA: em uma emergência, o que
se pergunta é "quanto tempo até voltar", e a resposta precisa ser medida.

**"O backup pesa no sistema?"**
Às 5h, com a casa fechada, não. O serviço ainda roda com prioridade baixa de
processador e de disco.

**"Posso apagar backup antigo à mão?"**
Não precisa: os locais saem sozinhos depois de 14 dias. Se precisar liberar
espaço agora, apague **do mais antigo para o mais novo** e nunca o mais
recente, que é o único que importa de verdade.

**"E se eu perder o servidor inteiro?"**
É o cenário para o qual existe a cópia externa. A ordem é: servidor novo,
Supabase de pé pelo compose, `restaurar.sh --do-remoto --para producao
--confirmo-producao`, conferir as contagens, repontar o DNS. É também o
procedimento que ninguém faz bem na primeira vez, e por isso o teste mensal no
staging vale o que custa.
