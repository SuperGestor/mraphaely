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
const ANONIMAS_PERMITIDAS = ['front/app/api/track/route.ts', 'front/app/api/tablet/[acao]/route.ts'];
for (const rota of rotas) {
  const src = fs.readFileSync(rota, 'utf8');
  const escreve = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(src);
  if (!escreve) continue;
  const r = rel(rota);
  const admin = r.startsWith('front/app/api/admin/');
  resultado(admin || ANONIMAS_PERMITIDAS.includes(r), `escrita em ${r}`, admin ? 'exige login (middleware) e papel (function)' : ANONIMAS_PERMITIDAS.includes(r) ? 'anônima permitida' : 'escrita anônima NÃO permitida');
}
resultado(!fs.existsSync(path.join(FRONT, 'app', 'api', 'orders')), 'não existe /api/orders na Fase A');
resultado(!fs.existsSync(path.join(FRONT, 'app', 'api', 'staff')), 'não existe /api/staff/orders na Fase A');
const mw = fs.readFileSync(path.join(FRONT, 'middleware.ts'), 'utf8');
resultado(mw.includes('"/api/admin/:path*"'), 'middleware cobre /api/admin');

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
  const MARCAS_DO_BACK = ['pixel.ingestao.invalida', 'admin_provision_device', 'tablet_pair_device', 'convidarNoAuth', 'servidor.5xx', 'admin_list_store_users'];
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
  await esperado('POST /api/orders devolve 404', status('POST', '/api/orders', {}), [404]);
  await esperado('POST /api/staff/orders devolve 404', status('POST', '/api/staff/orders', {}), [404]);
  await esperado('POST /api/admin/dispositivos sem login é recusado', status('POST', '/api/admin/dispositivos', {}), [401, 403, 503]);
  await esperado('POST /api/admin/usuarios sem login é recusado', status('POST', '/api/admin/usuarios', {}), [401, 403, 503]);
  await esperado('GET /api/tablet/cardapio sem token é recusado', status('GET', '/api/tablet/cardapio'), [401, 503]);
  await esperado('GET /api/tablet/cardapio com token falso é recusado', status('GET', '/api/tablet/cardapio', undefined, { 'x-device-token': 'AAAAAAAAAAAAAAAAAAAAAA' }), [401, 503]);
  await esperado('POST /api/tablet/parear com código falso é recusado', status('POST', '/api/tablet/parear', { codigo: 'AAAAAAAAAAAAAAAAAAAAAA' }), [401, 503]);
  await esperado('POST /api/track com evento de campo extra é recusado', status('POST', '/api/track', { session_id: '00000000-0000-4000-8000-000000000001', store_id: '00000000-0000-4000-8000-000000000002', events: [{ event_type: 'page_view', at: new Date().toISOString(), nome: 'Maria' }] }), [400]);
}

console.log(`\nRESULTADO: ${ok} passaram, ${falhas} falharam.`);
process.exit(falhas ? 1 : 0);
