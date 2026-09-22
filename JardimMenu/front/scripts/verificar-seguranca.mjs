// Verificações de segurança do prompt 2 que não são de banco (item 7 e regras 1 e 4).
//
//   node scripts/verificar-seguranca.mjs                 só as checagens estáticas
//   node scripts/verificar-seguranca.mjs --url http://localhost:3000
//                                                        e também as de rota, no servidor
//
// Rode depois do `npm run build`: a checagem do bundle lê .next/static.
import fs from 'node:fs';
import path from 'node:path';

const FRONT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const RAIZ = path.resolve(FRONT, '..');
const BACK = path.join(RAIZ, 'back');
const urlIdx = process.argv.indexOf('--url');
const BASE = urlIdx > 0 ? process.argv[urlIdx + 1] : null;

let ok = 0;
let falhas = 0;
const resultado = (passou, nome, detalhe = '') => {
  if (passou) ok++;
  else falhas++;
  console.log(`  ${passou ? 'ok   ' : 'FALHA'} ${nome}${detalhe ? ` -> ${detalhe}` : ''}`);
};

function arquivos(dir, filtro, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const nome of fs.readdirSync(dir)) {
    if (['node_modules', '.next', 'public'].includes(nome)) continue;
    const p = path.join(dir, nome);
    const st = fs.statSync(p);
    if (st.isDirectory()) arquivos(p, filtro, acc);
    else if (filtro(p)) acc.push(p);
  }
  return acc;
}
const rel = (p) => path.relative(RAIZ, p).split(path.sep).join('/');

// ---------- 1. Rotas que escrevem ----------
console.log('=== Rotas de escrita (regra 1)');
const rotas = arquivos(path.join(FRONT, 'app', 'api'), (p) => /route\.tsx?$/.test(p));
// A única escrita anônima é o pixel (regra 1).
const ANONIMAS_PERMITIDAS = ['front/app/api/track/route.ts'];
// Rotas do tablet: sem cookie, mas com X-Device-Token, conferido na function do banco.
const COM_DISPOSITIVO = ['front/app/api/tablet/[acao]/route.ts', 'front/app/api/orders/route.ts'];
// O pareamento do tablet não tem cookie: quem autoriza é o login do dono ou do gestor,
// enviado no corpo e conferido no servidor (decisão de 21/09/2026).
const LOGIN_NO_CORPO = ['front/app/api/tablet/configurar/route.ts'];
for (const rota of rotas) {
  const src = fs.readFileSync(rota, 'utf8');
  const escreve = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(src);
  if (!escreve) continue;
  const r = rel(rota);
  const admin = r.startsWith('front/app/api/admin/') || r.startsWith('front/app/api/equipe/');
  const comLogin = LOGIN_NO_CORPO.includes(r);
  const dispositivo = COM_DISPOSITIVO.includes(r);
  const pixel = ANONIMAS_PERMITIDAS.includes(r);
  resultado(admin || comLogin || dispositivo || pixel, `escrita em ${r}`, admin ? 'exige login (middleware) e papel (function)' : comLogin ? 'exige login do dono ou gestor no corpo' : dispositivo ? 'exige X-Device-Token, conferido no banco' : pixel ? 'anônima permitida (pixel)' : 'escrita anônima NÃO permitida');
}
const rotaDoPedido = path.join(FRONT, 'app', 'api', 'orders', 'route.ts');
resultado(fs.existsSync(rotaDoPedido) && fs.readFileSync(rotaDoPedido, 'utf8').includes('enviarPedido'), '/api/orders passa pelo controller do tablet (X-Device-Token e Idempotency-Key)');
resultado(!fs.existsSync(path.join(FRONT, 'app', 'api', 'staff')), 'não existe /api/staff/orders antes da Fase C (JM-110)');
const mw = fs.readFileSync(path.join(FRONT, 'middleware.ts'), 'utf8');
resultado(mw.includes('"/api/admin/:path*"') && mw.includes('"/api/equipe/:path*"') && mw.includes('"/equipe/:path*"'), 'middleware cobre /api/admin, /equipe e /api/equipe');

// O service worker nunca guarda a conta da mesa nem a tela da equipe (JM-011, JM-012).
const sw = fs.readFileSync(path.join(FRONT, 'app', 'sw.ts'), 'utf8');
const regraDoSw = sw.match(/const ROTAS_SEM_CACHE =\s*(\/.*\/);/);
let semCache = null;
try { semCache = regraDoSw ? eval(regraDoSw[1]) : null; } catch { semCache = null; }
const soRede = ['/api/tablet/resumo', '/api/tablet/horario', '/api/tablet/pareamento', '/equipe', '/api/equipe/salao', '/admin', '/login', '/jardim-secreto/tablet/setup'];
resultado(semCache !== null && soRede.every((p) => semCache.test(p)), 'service worker: resumo, horário, pareamento, equipe, admin e login só pela rede', soRede.filter((p) => !semCache?.test(p)).join(', ') || 'todas cobertas');

// Realtime só na tela da equipe (§8.6): o cliente do navegador não chega ao tablet.
const importamRealtime = arquivos(FRONT, (p) => /\.(ts|tsx)$/.test(p) && !p.includes('node_modules') && !p.includes(`${path.sep}.next${path.sep}`))
  .filter((p) => !p.endsWith('supabase-navegador.ts') && fs.readFileSync(p, 'utf8').includes('supabase-navegador'))
  .map(rel);
resultado(importamRealtime.length === 1 && importamRealtime[0].endsWith('equipe-source.ts'), 'o cliente Realtime do navegador só é usado pela tela da equipe', importamRealtime.join(', ') || 'ninguém importa');

// ---------- 2. service_role num único arquivo ----------
console.log('\n=== Chave service_role (regra 4)');
const NOME_DA_CHAVE = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
const fontes = [
  ...arquivos(FRONT, (p) => /\.(ts|tsx|mjs|js)$/.test(p) && !p.includes(`${path.sep}scripts${path.sep}`)),
  ...arquivos(BACK, (p) => /\.(ts|tsx|mjs|js)$/.test(p)),
];
const comChave = fontes.filter((p) => fs.readFileSync(p, 'utf8').includes(NOME_DA_CHAVE)).map(rel);
resultado(
  comChave.length === 1 && comChave[0] === 'back/services/invite-user.ts',
  'a chave é lida em um único arquivo nomeado',
  comChave.join(', ') || 'nenhum',
);
const publicas = fontes.filter((p) => /NEXT_PUBLIC_[A-Z_]*(SERVICE|SECRET|PRIVATE)/.test(fs.readFileSync(p, 'utf8'))).map(rel);
resultado(publicas.length === 0, 'nenhuma variável NEXT_PUBLIC_ com cara de segredo', publicas.join(', ') || 'nenhuma');

// ---------- 3. back/ nunca em componente de cliente ----------
console.log('\n=== back/ fora do navegador (D33)');
const clientes = arquivos(FRONT, (p) => /\.(ts|tsx)$/.test(p)).filter((p) => /^\s*["']use client["']/.test(fs.readFileSync(p, 'utf8')));
const vazam = clientes.filter((p) => /from\s+["']@back\//.test(fs.readFileSync(p, 'utf8'))).map(rel);
resultado(vazam.length === 0, 'nenhum componente "use client" importa @back/', vazam.join(', ') || `${clientes.length} componentes de cliente conferidos`);
// components/ e lib/ são código de cliente: nenhum import de back/, nem de passagem.
const deCliente = [
  ...arquivos(path.join(FRONT, 'components'), (p) => /\.(ts|tsx)$/.test(p)),
  ...arquivos(path.join(FRONT, 'lib'), (p) => /\.(ts|tsx)$/.test(p)),
];
const backEmCliente = deCliente.filter((p) => /from\s+["'](@back\/|(\.\.\/)+back\/)/.test(fs.readFileSync(p, 'utf8'))).map(rel);
resultado(backEmCliente.length === 0, 'components/ e lib/ não importam back/', backEmCliente.join(', ') || `${deCliente.length} arquivos conferidos`);

// ---------- 4. Bundle publicado ----------
console.log('\n=== Bundle publicado (§9.4)');
const STATIC = path.join(FRONT, '.next', 'static');
if (!fs.existsSync(STATIC)) {
  resultado(false, 'bundle encontrado', 'rode npm run build antes');
} else {
  const js = arquivos(STATIC, (p) => p.endsWith('.js'));
  const achados = [];
  const valorDaChave = process.env[NOME_DA_CHAVE];
  // Textos que só existem em back/: se um deles aparecer no bundle, código de servidor
  // foi parar no navegador (D33). É a prova do resultado, e não da intenção.
  const MARCAS_DO_BACK = ['pixel.ingestao.invalida', 'staff_pair_device', 'convidarNoAuth', 'servidor.5xx', 'admin_list_store_users'];
  for (const p of js) {
    const src = fs.readFileSync(p, 'utf8');
    for (const marca of MARCAS_DO_BACK) {
      if (src.includes(marca)) achados.push(`${rel(p)}: marca do back/ "${marca}"`);
    }
    if (src.includes('service_role')) achados.push(`${rel(p)}: "service_role"`);
    if (src.includes(NOME_DA_CHAVE)) achados.push(`${rel(p)}: nome da chave`);
    if (valorDaChave && src.includes(valorDaChave)) achados.push(`${rel(p)}: VALOR da chave`);
  }
  resultado(achados.length === 0, `grep em ${js.length} arquivos do bundle`, achados.join(' | ') || 'nada encontrado');

  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anon) {
    let papel = 'ilegível';
    try { papel = JSON.parse(Buffer.from(anon.split('.')[1], 'base64url').toString()).role; } catch {}
    resultado(papel === 'anon', 'a chave pública do Supabase é mesmo a anon', `role=${papel}`);
  }
}

// ---------- 5. Rotas no servidor ----------
if (BASE) {
  console.log(`\n=== Rotas no servidor (${BASE})`);
  const status = async (metodo, caminho, corpo, headers = {}) => {
    const r = await fetch(BASE + caminho, { method: metodo, headers: { 'content-type': 'application/json', ...headers }, body: corpo === undefined ? undefined : JSON.stringify(corpo), redirect: 'manual' });
    return r.status;
  };
  const esperado = async (nome, promessa, aceita) => {
    const s = await promessa;
    resultado(aceita.includes(s), nome, `HTTP ${s}`);
  };
  await esperado('POST /api/orders sem X-Device-Token é recusado', status('POST', '/api/orders', {}, { 'idempotency-key': 'chave-de-teste-0001' }), [401, 503]);
  await esperado('POST /api/orders com token falso é recusado', status('POST', '/api/orders', { session_id: '00000000-0000-4000-8000-000000000001', tab_id: '00000000-0000-4000-8000-000000000002', items: [{ product_id: '00000000-0000-4000-8000-000000000003', quantity: 1, option_ids: [], notes: null }] }, { 'x-device-token': 'AAAAAAAAAAAAAAAAAAAAAA', 'idempotency-key': 'chave-de-teste-0001' }), [401, 503]);
  await esperado('POST /api/equipe/cancelar_pedido sem login é recusado', status('POST', '/api/equipe/cancelar_pedido', {}), [401, 503]);
  await esperado('GET /api/equipe/salao sem login é recusado', status('GET', '/api/equipe/salao?loja=00000000-0000-4000-8000-000000000001'), [401, 503]);
  await esperado('POST /api/staff/orders devolve 404 (Fase C)', status('POST', '/api/staff/orders', {}), [404]);
  await esperado('POST /api/admin/dispositivos sem login é recusado', status('POST', '/api/admin/dispositivos', {}), [401, 403, 503]);
  await esperado('POST /api/admin/usuarios sem login é recusado', status('POST', '/api/admin/usuarios', {}), [401, 403, 503]);
  await esperado('GET /api/tablet/cardapio sem token é recusado', status('GET', '/api/tablet/cardapio'), [401, 503]);
  await esperado('GET /api/tablet/cardapio com token falso é recusado', status('GET', '/api/tablet/cardapio', undefined, { 'x-device-token': 'AAAAAAAAAAAAAAAAAAAAAA' }), [401, 503]);
  await esperado('POST /api/tablet/parear não existe mais', status('POST', '/api/tablet/parear', { codigo: 'AAAAAAAAAAAAAAAAAAAAAA' }), [404]);
  await esperado('POST /api/tablet/configurar com login falso é recusado', status('POST', '/api/tablet/configurar', { loja: 'jardim-secreto', email: 'ninguem@exemplo.com', senha: 'senha-errada-123', mesa: 1 }), [401, 503]);
  await esperado('POST /api/track com evento de campo extra é recusado', status('POST', '/api/track', { session_id: '00000000-0000-4000-8000-000000000001', store_id: '00000000-0000-4000-8000-000000000002', events: [{ event_type: 'page_view', at: new Date().toISOString(), nome: 'Maria' }] }), [400]);
}

console.log(`\nRESULTADO: ${ok} passaram, ${falhas} falharam.`);
process.exit(falhas ? 1 : 0);
