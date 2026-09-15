// Verificação ponta a ponta do prompt 2: Supabase local + servidor Next de produção.
//
//   1. em back/:  npx supabase db reset --local         (massa limpa do seed)
//   2. em front/: npm run build && npm run start         (com .env.local apontando para o local)
//   3. em front/: node --env-file=.env.local scripts/verificar-ponta-a-ponta.mjs --url http://localhost:3000
//
// Usa só a chave anon e os usuários fictícios do seed (back/supabase/seed.sql). Nenhuma
// service_role: o login é o mesmo @supabase/ssr do admin, com os cookies num pote em memória.
// Grava dados de teste. Para rodar de novo, faça outro `db reset` antes.
import crypto from 'node:crypto';
import sharp from 'sharp';
import { createServerClient } from '@supabase/ssr';

const urlIdx = process.argv.indexOf('--url');
const BASE = urlIdx > 0 ? process.argv[urlIdx + 1] : 'http://localhost:3000';
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
if (!SB_URL || !SB_ANON) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY. Rode com --env-file=.env.local.');
  process.exit(2);
}

// ---------- massa do seed ----------
const SENHA = 'jardim-local-123';
const JARDIM = '30000000-0000-4000-8000-000000000001';
const CONFRARIA = '30000000-0000-4000-8000-000000000002';
const CAT_CONFRARIA = '40000000-0000-4000-8000-000000000009';
const ANCHO = '50000000-0000-4000-8000-000000000003';
const BURGER = '50000000-0000-4000-8000-000000000004';
const AO_PONTO = '70000000-0000-4000-8000-000000000001';
const BACON = '70000000-0000-4000-8000-000000000003';
const QUEIJO = '70000000-0000-4000-8000-000000000004';
const OVO = '70000000-0000-4000-8000-000000000005';

// ---------- utilitários ----------
let ok = 0;
let falhas = 0;
const confere = (passou, nome, detalhe = '') => {
  if (passou) ok++;
  else falhas++;
  console.log(`  ${passou ? 'ok   ' : 'FALHA'} ${nome}${detalhe === '' ? '' : ` -> ${detalhe}`}`);
};
const secao = (titulo) => console.log(`\n=== ${titulo}`);
const det = (r) => `HTTP ${r.status}${r.json?.codigo ? ` ${r.json.codigo}` : ''}${r.json?.mensagem ? ` "${r.json.mensagem}"` : ''}`;
const espera = (ms) => new Promise((fim) => setTimeout(fim, ms));

async function http(metodo, caminho, { corpo, cookie, headers = {}, form } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  let body;
  if (form) body = form;
  else if (corpo !== undefined) {
    h['content-type'] = 'application/json';
    body = JSON.stringify(corpo);
  }
  const r = await fetch(BASE + caminho, { method: metodo, headers: h, body, redirect: 'manual' });
  const texto = await r.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {}
  return { status: r.status, json, texto, headers: r.headers };
}

async function entrar(email) {
  const pote = new Map();
  const supabase = createServerClient(SB_URL, SB_ANON, {
    cookies: {
      getAll: () => [...pote].map(([name, value]) => ({ name, value })),
      setAll: (lista) => {
        for (const { name, value } of lista) {
          if (value) pote.set(name, value);
          else pote.delete(name);
        }
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password: SENHA });
  if (error) throw new Error(`login de ${email} falhou: ${error.message}`);
  return { email, supabase, cookie: [...pote].map(([n, v]) => `${n}=${v}`).join('; ') };
}

const token = (t) => ({ 'x-device-token': t ?? '' });
const rpc = (quem, fn, corpo) => http('POST', `/api/admin/rpc/${fn}`, { cookie: quem.cookie, corpo });
const codigoDaUrl = (url) => (url ? new URL(url).searchParams.get('codigo') : null);

console.log(`Servidor: ${BASE}\nSupabase: ${SB_URL}`);

// ============================================================
secao('0. Sem login');
let r = await http('GET', '/api/admin/dados/contexto');
confere(r.status === 401, 'API do admin sem login responde 401', det(r));
r = await http('GET', '/admin');
confere(
  [302, 303, 307, 308].includes(r.status) && (r.headers.get('location') ?? '').includes('/login'),
  'página /admin sem login vai para /login',
  `HTTP ${r.status} -> ${r.headers.get('location')}`,
);

// ============================================================
secao('1. Login da equipe (@supabase/ssr) e contexto');
let dono, gestor, garcom, outraLoja;
try {
  [dono, gestor, garcom, outraLoja] = await Promise.all(
    ['dono@jardim.local', 'gestor@jardim.local', 'garcom@jardim.local', 'gestor@confraria.local'].map(entrar),
  );
  confere(true, 'os quatro usuários do seed entram');
} catch (e) {
  confere(false, 'os quatro usuários do seed entram', e.message);
  process.exit(1);
}
r = await http('GET', '/api/admin/dados/contexto', { cookie: dono.cookie });
const lojasDoDono = (r.json?.lojas ?? []).map((l) => `${l.stores?.slug}:${l.role}`).join(', ');
confere(r.status === 200 && lojasDoDono === 'jardim-secreto:owner', 'contexto do dono: só o Jardim, como dono', lojasDoDono || det(r));

// ============================================================
secao('2. Leituras do admin, sob RLS');
r = await http('GET', `/api/admin/dados/cardapio?loja=${JARDIM}`, { cookie: dono.cookie });
const qtd = (x) => `${x?.categorias?.length} categorias, ${x?.produtos?.length} produtos, ${x?.grupos?.length} grupos`;
confere(
  r.status === 200 && r.json.categorias.length === 3 && r.json.produtos.length === 5 && r.json.grupos.length === 2,
  'cardápio do Jardim no admin',
  qtd(r.json),
);
r = await http('GET', `/api/admin/dados/cardapio?loja=${CONFRARIA}`, { cookie: dono.cookie });
confere(r.status === 200 && r.json.produtos.length === 0 && r.json.categorias.length === 0, 'dono do Jardim não lê o cardápio da Confraria', qtd(r.json));
r = await http('GET', `/api/admin/dados/cardapio?loja=${JARDIM}`, { cookie: outraLoja.cookie });
confere(r.status === 200 && r.json.produtos.length === 0, 'gestor da Confraria não lê o cardápio do Jardim', qtd(r.json));

r = await http('GET', `/api/admin/dados/mesas?loja=${JARDIM}`, { cookie: dono.cookie });
const mesas = r.json?.mesas ?? [];
confere(r.status === 200 && mesas.length === 10, 'mesas do Jardim', `${mesas.length} mesas`);
confere(!/qr_token|token_hash|pairing_code_hash/.test(r.texto), 'leitura de mesas sem qr_token nem hash');
const mesa1 = mesas.find((m) => m.number === 1)?.id;
const mesa2 = mesas.find((m) => m.number === 2)?.id;

r = await http('GET', `/api/admin/dados/usuarios?loja=${JARDIM}`, { cookie: dono.cookie });
const emails = (Array.isArray(r.json) ? r.json : []).map((u) => `${u.email}:${u.role}`).sort().join(', ');
confere(
  r.status === 200 && emails === 'dono@jardim.local:owner, garcom@jardim.local:waiter, gestor@jardim.local:manager',
  'usuários da loja, com e-mail vindo do Auth',
  emails || det(r),
);
r = await http('GET', `/api/admin/dados/usuarios?loja=${JARDIM}`, { cookie: garcom.cookie });
confere(r.status === 403, 'garçom não lista usuários', det(r));

// ============================================================
secao('3. Escritas do admin, por function');
const produtoBase = {
  p_store_id: JARDIM,
  p_id: null,
  p_description: null,
  p_emoji: null,
  p_is_featured: false,
  p_available_window: null,
  p_pdv_code: null,
  p_sort_order: 9,
  p_is_active: true,
};
r = await rpc(dono, 'admin_upsert_category', { p_store_id: JARDIM, p_id: null, p_name: 'Sobremesas', p_sort_order: 4, p_is_active: true });
const categoriaNova = r.json?.resultado;
confere(r.status === 200 && /^[0-9a-f-]{36}$/.test(categoriaNova ?? ''), 'dono cria categoria', det(r));
r = await rpc(dono, 'admin_upsert_product', {
  ...produtoBase,
  p_category_id: categoriaNova,
  p_name: 'Pudim de tapioca',
  p_description: 'Calda de coco queimado.',
  p_price: 18.5,
  p_emoji: '🍮',
  p_pdv_code: 'PDV-1501',
});
confere(r.status === 200 && /^[0-9a-f-]{36}$/.test(r.json?.resultado ?? ''), 'dono cria produto na categoria nova', det(r));
r = await rpc(dono, 'admin_upsert_product', { ...produtoBase, p_category_id: CAT_CONFRARIA, p_name: 'Invasor', p_price: 10 });
confere(r.status === 422, 'produto com categoria de outra loja é recusado no banco', det(r));
r = await rpc(dono, 'admin_upsert_product', { ...produtoBase, p_category_id: categoriaNova, p_name: 'Negativo', p_price: -1 });
confere(r.status === 422, 'preço negativo é recusado', det(r));
r = await rpc(dono, 'admin_upsert_product', { ...produtoBase, p_category_id: categoriaNova, p_name: 'Extra', p_price: 1, preco_final: 0 });
confere(r.status === 422, 'campo fora do schema é recusado', det(r));
r = await rpc(dono, 'jm_require_role', { p_store_id: JARDIM, p_roles: ['owner'] });
confere(r.status === 404, 'function fora da lista fechada responde 404', det(r));
r = await rpc(dono, 'admin_update_store_appearance', { p_store_id: JARDIM, p_primary: '#f5e663', p_accent: '#2f5d3a', p_logo_url: null });
confere(r.status === 422, 'cor primária sem contraste AA é recusada no banco', det(r));
r = await rpc(dono, 'admin_upsert_table', { p_store_id: JARDIM, p_id: null, p_number: 1, p_label: null, p_is_active: true });
confere(r.status === 409, 'mesa com número repetido responde 409', det(r));
r = await rpc(dono, 'admin_upsert_table', { p_store_id: JARDIM, p_id: null, p_number: 11, p_label: 'Varanda 5', p_is_active: true });
confere(r.status === 200, 'dono cria a mesa 11', det(r));

// ============================================================
secao('4. Papéis e isolamento nas escritas');
const categoriaInvasora = { p_store_id: JARDIM, p_id: null, p_name: 'Invasão', p_sort_order: 1, p_is_active: true };
r = await rpc(outraLoja, 'admin_upsert_category', categoriaInvasora);
confere(r.status === 403, 'gestor da Confraria não escreve no Jardim', det(r));
r = await rpc(garcom, 'admin_upsert_category', categoriaInvasora);
confere(r.status === 403, 'garçom não edita o cardápio', det(r));
r = await rpc(garcom, 'staff_set_product_availability', { p_product_id: ANCHO, p_available: false });
confere(r.status === 200, 'garçom marca o Ancho como esgotado (JM-004)', det(r));
r = await rpc(outraLoja, 'staff_set_product_availability', { p_product_id: ANCHO, p_available: true });
confere([403, 404].includes(r.status), 'gestor da Confraria não mexe na disponibilidade do Jardim', det(r));

// ============================================================
secao('5. Dispositivo: provisionar, parear, ler');
r = await http('POST', '/api/admin/dispositivos', { cookie: outraLoja.cookie, corpo: { store_id: JARDIM, table_id: mesa1, name: 'Intruso' } });
confere(r.status === 403, 'gestor da Confraria não provisiona tablet no Jardim', det(r));

r = await http('POST', '/api/admin/dispositivos', { cookie: dono.cookie, corpo: { store_id: JARDIM, table_id: mesa1, name: 'Tablet mesa 1' } });
const disp1 = r.json?.dispositivo;
const url1 = r.json?.pareamento?.url ?? '';
confere(
  r.status === 201 && url1.includes('/jardim-secreto/tablet/setup?codigo=') && String(r.json?.pareamento?.qr).startsWith('data:image/png;base64,'),
  'dono provisiona o tablet da mesa 1, com QR de pareamento',
  r.status === 201 ? url1.replace(/codigo=.*/, 'codigo=…') : det(r),
);
confere(!/token_hash|pairing_code_hash|"token"/.test(r.texto), 'provisionamento não devolve token nem hash');
const codigo1 = codigoDaUrl(url1);

r = await http('GET', '/api/tablet/cardapio', { headers: token(codigo1) });
confere(r.status === 401, 'o código de pareamento não serve como token', det(r));
r = await http('POST', '/api/tablet/parear', { corpo: { codigo: codigo1 } });
const token1 = r.json?.token;
confere(
  r.status === 200 && /^[A-Za-z0-9_-]{22}$/.test(token1 ?? '') && r.json?.loja === 'jardim-secreto' && r.json?.mesa === 1,
  'tablet troca o código pelo token, com loja e mesa certas',
  r.status === 200 ? `loja=${r.json?.loja} mesa=${r.json?.mesa} token de ${String(token1).length} caracteres` : det(r),
);
confere((r.headers.get('cache-control') ?? '').includes('no-store'), 'resposta do pareamento sem cache', r.headers.get('cache-control'));
r = await http('POST', '/api/tablet/parear', { corpo: { codigo: codigo1 } });
confere(r.status === 401, 'o mesmo código não pareia de novo (uso único)', det(r));

r = await http('GET', `/api/admin/dados/dispositivos?loja=${JARDIM}`, { cookie: dono.cookie });
const visto1 = r.json?.dispositivos?.find((d) => d.id === disp1?.id);
confere(visto1?.is_paired === true && visto1?.pairing_expires_at === null, 'admin vê o tablet pareado', JSON.stringify({ is_paired: visto1?.is_paired, pairing_expires_at: visto1?.pairing_expires_at }));
confere(!/token_hash|pairing_code_hash/.test(r.texto), 'leitura de dispositivos sem hash');
r = await http('POST', `/api/admin/dispositivos/${disp1?.id}`, { cookie: dono.cookie, corpo: { acao: 'novo_codigo' } });
confere(r.status === 409, 'tablet já pareado não recebe código novo', det(r));

r = await http('GET', '/api/tablet/pareamento', { headers: token(token1) });
confere(r.status === 200 && r.json?.table_number === 1 && r.json?.store_slug === 'jardim-secreto', 'tablet resolve loja e mesa pelo token', det(r));
r = await http('GET', '/api/tablet/cardapio', { headers: token(token1) });
const produtosNoTablet = r.json?.products ?? [];
const nomes = produtosNoTablet.map((p) => p.name);
confere(r.status === 200 && r.json?.store?.slug === 'jardim-secreto' && r.json?.table_number === 1, 'cardápio do tablet: loja do token, mesa 1', det(r));
confere(nomes.includes('Pudim de tapioca'), 'produto criado no admin aparece no tablet', nomes.join(', '));
confere(!nomes.includes('Vinho da Confraria'), 'nada da outra loja no tablet');
confere(!r.texto.includes('PDV-'), 'código do PDV não sai para o tablet');
const anchoNoTablet = produtosNoTablet.find((p) => p.id === ANCHO);
confere(!anchoNoTablet || anchoNoTablet.is_available === false, 'esgotado pelo garçom não fica pedível no tablet', anchoNoTablet ? 'listado com is_available=false' : 'fora da lista');
r = await http('GET', '/api/tablet/horario', { headers: token(token1) });
confere(r.status === 200 && r.json?.is_open === true, 'horário resolvido no banco: Jardim sem restrição, aberto', det(r));

// ============================================================
secao('6. Preço no servidor (JM-031)');
const total = (corpo, t = token1) => http('POST', '/api/tablet/total', { headers: token(t), corpo });
r = await total({ product_id: BURGER, quantity: 2, option_ids: [AO_PONTO, BACON, QUEIJO] });
confere(r.status === 200 && Number(r.json?.unit_total) === 68 && Number(r.json?.line_total) === 136, 'Burger ao ponto + bacon + queijo, 2 unidades: 136,00', `${det(r)} ${JSON.stringify(r.json)}`);
r = await total({ product_id: BURGER, quantity: 1, option_ids: [BACON] });
confere(r.status === 422, 'grupo obrigatório sem escolha é recusado', det(r));
r = await total({ product_id: BURGER, quantity: 1, option_ids: [AO_PONTO, OVO] });
// O JM-004 nomeia só o produto indisponível; complemento esgotado é escolha inválida.
confere(r.status === 422, 'complemento esgotado é recusado', det(r));
r = await total({ product_id: ANCHO, quantity: 1, option_ids: [AO_PONTO] });
confere(r.status === 409 && r.json?.codigo === 'JM451', 'produto esgotado é recusado', det(r));
r = await rpc(gestor, 'staff_set_product_availability', { p_product_id: ANCHO, p_available: true });
confere(r.status === 200, 'gestor volta o Ancho', det(r));
r = await total({ product_id: ANCHO, quantity: 1, option_ids: [AO_PONTO, BACON] });
confere(r.status === 422, 'complemento de grupo que não é do produto é recusado', det(r));
r = await total({ product_id: BURGER, quantity: 1, option_ids: [AO_PONTO], price: 1 });
confere(r.status === 422, 'preço no corpo não existe no contrato', det(r));
r = await http('POST', '/api/tablet/total', { corpo: { product_id: BURGER, quantity: 1, option_ids: [AO_PONTO] } });
confere(r.status === 401, 'total sem X-Device-Token é recusado', det(r));

// ============================================================
secao('7. Ciclo de vida do dispositivo');
r = await http('POST', '/api/admin/dispositivos', { cookie: gestor.cookie, corpo: { store_id: JARDIM, table_id: mesa1, name: 'Tablet mesa 1 (troca)' } });
const disp2 = r.json?.dispositivo;
const codigo2 = codigoDaUrl(r.json?.pareamento?.url);
confere(r.status === 201, 'gestor reprovisiona a mesa 1 (troca de tablet)', det(r));
r = await http('GET', '/api/tablet/cardapio', { headers: token(token1) });
confere(r.status === 410, 'token do tablet substituído responde 410', det(r));
r = await http('POST', '/api/tablet/parear', { corpo: { codigo: codigo2 } });
const token2 = r.json?.token;
confere(r.status === 200, 'tablet novo pareia', det(r));
r = await http('POST', `/api/admin/dispositivos/${disp2?.id}`, { cookie: gestor.cookie, corpo: { acao: 'estado', status: 'inactive' } });
confere(r.status === 200, 'gestor desativa o tablet', det(r));
r = await http('GET', '/api/tablet/cardapio', { headers: token(token2) });
confere(r.status === 423, 'tablet desativado responde 423', det(r));
r = await http('POST', `/api/admin/dispositivos/${disp2?.id}`, { cookie: gestor.cookie, corpo: { acao: 'estado', status: 'active' } });
const reativou = r.status;
r = await http('GET', '/api/tablet/cardapio', { headers: token(token2) });
confere(reativou === 200 && r.status === 200, 'tablet reativado volta a ler o cardápio', `reativar HTTP ${reativou}, cardápio ${det(r)}`);
r = await http('POST', `/api/admin/dispositivos/${disp2?.id}`, { cookie: outraLoja.cookie, corpo: { acao: 'estado', status: 'retired' } });
confere(r.status === 403, 'gestor da Confraria não aposenta tablet do Jardim', det(r));
r = await http('POST', `/api/admin/dispositivos/${disp1?.id}`, { cookie: dono.cookie, corpo: { acao: 'estado', status: 'active' } });
confere(r.status === 410, 'tablet aposentado não volta', det(r));

r = await http('POST', '/api/admin/dispositivos', { cookie: dono.cookie, corpo: { store_id: JARDIM, table_id: mesa2, name: 'Tablet mesa 2' } });
const disp3 = r.json?.dispositivo;
const codigoA = codigoDaUrl(r.json?.pareamento?.url);
r = await http('POST', `/api/admin/dispositivos/${disp3?.id}`, { cookie: dono.cookie, corpo: { acao: 'novo_codigo' } });
const codigoB = codigoDaUrl(r.json?.pareamento?.url);
confere(r.status === 200 && codigoB && codigoB !== codigoA, 'tablet que não pareou recebe código novo', det(r));
r = await http('POST', '/api/tablet/parear', { corpo: { codigo: codigoA } });
confere(r.status === 401, 'o código anterior morre quando o novo é gerado', det(r));
r = await http('POST', '/api/tablet/parear', { corpo: { codigo: codigoB } });
confere(r.status === 200 && r.json?.mesa === 2, 'o código novo pareia a mesa 2', det(r));

// ============================================================
secao('8. Pixel (JM-061, JM-062)');
const sessao = crypto.randomUUID();
const agora = new Date().toISOString();
r = await http('POST', '/api/track', {
  corpo: {
    session_id: sessao,
    store_id: JARDIM,
    events: [
      { event_type: 'page_view', at: agora },
      { event_type: 'product_impression', product_id: BURGER, at: agora },
      { event_type: 'product_view_time', product_id: BURGER, value_ms: 4200, at: agora },
    ],
  },
});
confere(r.status === 202 && r.json?.gravado === true && r.json?.aceitos === 3, 'pixel grava 3 eventos', `HTTP ${r.status} ${r.texto}`);
r = await http('POST', '/api/track', {
  corpo: { session_id: sessao, store_id: JARDIM, events: Array.from({ length: 60 }, () => ({ event_type: 'product_impression', product_id: BURGER, at: agora })) },
});
confere(r.status === 202 && r.json?.aceitos === 50 && r.json?.descartados === 10, 'lote de 60: 50 gravados, 10 descartados, 202', `HTTP ${r.status} ${r.texto}`);
r = await http('POST', '/api/track', { corpo: { session_id: sessao, store_id: JARDIM, events: [{ event_type: 'page_view', at: agora, nome: 'Maria' }] } });
confere(r.status === 400, 'evento com campo pessoal é recusado', `HTTP ${r.status}`);
r = await http('POST', '/api/track', { corpo: { session_id: crypto.randomUUID(), store_id: crypto.randomUUID(), events: [{ event_type: 'page_view', at: agora }] } });
confere(r.status === 202 && r.json?.gravado === false, 'loja inexistente não vira erro para o tablet, e nada é gravado', `HTTP ${r.status} ${r.texto}`);

const lidos = await dono.supabase.from('menu_events').select('event_type').eq('session_id', sessao);
confere(!lidos.error && lidos.data?.length === 53, 'no banco: 53 eventos da sessão, lidos pelo dono sob RLS', lidos.error?.message ?? `${lidos.data?.length} eventos`);
const lidosPeloGarcom = await garcom.supabase.from('menu_events').select('id').eq('session_id', sessao);
confere((lidosPeloGarcom.data ?? []).length === 0, 'garçom não lê o pixel', `${(lidosPeloGarcom.data ?? []).length} eventos`);

// ============================================================
secao('9. Foto do produto (JM-002, §18.4) e Storage');
const desenho = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#6b8f4e"/>' +
    '<circle cx="600" cy="450" r="300" fill="#e0b050"/><circle cx="520" cy="380" r="60" fill="#8a3b1f"/>' +
    '<rect x="380" y="560" width="440" height="60" rx="30" fill="#3d2b1f"/></svg>',
);
const jpeg = await sharp(desenho).jpeg({ quality: 88 }).toBuffer();
const pequena = await sharp(desenho).resize(600, 450).jpeg().toBuffer();
const enviar = (quem, produto, buffer) => {
  const form = new FormData();
  form.append('foto', new Blob([buffer], { type: 'image/jpeg' }), 'foto.jpg');
  return http('POST', `/api/admin/produtos/${produto}/foto`, { cookie: quem.cookie, form });
};

r = await enviar(dono, BURGER, jpeg);
const caminho = r.json?.photo_path;
confere(r.status === 201 && String(caminho).startsWith(`${JARDIM}/${BURGER}/v`), `dono envia foto (JPEG 1200x900, ${Math.round(jpeg.length / 1024)} KB)`, det(r));
for (const [nome, largura, teto] of [['grade', 400, 45], ['vitrine', 600, 70], ['modal', 900, 120]]) {
  const f = await fetch(`${SB_URL}/storage/v1/object/public/produtos/${caminho}/${nome}.webp`);
  const bytes = Buffer.from(await f.arrayBuffer());
  const meta = f.ok ? await sharp(bytes).metadata() : {};
  confere(
    f.status === 200 && f.headers.get('content-type') === 'image/webp' && bytes.length <= teto * 1024 && meta.width === largura && meta.height === (largura * 3) / 4,
    `${nome}.webp servida pelo Storage: ${largura}px em 4:3, até ${teto} KB`,
    `HTTP ${f.status}, ${f.headers.get('content-type')}, ${(bytes.length / 1024).toFixed(1)} KB, ${meta.width}x${meta.height}`,
  );
}
r = await http('GET', '/api/tablet/cardapio', { headers: token(token2) });
confere(r.json?.products?.find((p) => p.id === BURGER)?.photo_path === caminho, 'tablet recebe o caminho da foto nova');
r = await enviar(dono, BURGER, pequena);
confere(r.status === 422, 'foto com menos de 800px no menor lado é recusada', det(r));
r = await enviar(garcom, BURGER, jpeg);
confere(r.status === 403, 'garçom não envia foto (policy do Storage)', det(r));
r = await enviar(outraLoja, BURGER, jpeg);
confere([403, 404].includes(r.status), 'gestor da Confraria não envia foto para produto do Jardim', det(r));

// ============================================================
secao('10. Usuários: convite, papel, desativação (JM-052)');
const carimbo = Date.now();
const emailNovo = `convite.${carimbo}@jardim.local`;
const emailDoGestor = `tentativa.${carimbo}@jardim.local`;
r = await http('POST', '/api/admin/usuarios', { cookie: gestor.cookie, corpo: { store_id: JARDIM, email: emailDoGestor, role: 'waiter' } });
confere(r.status === 403, 'gestor não convida (só o dono)', det(r));
r = await http('POST', '/api/admin/usuarios', { cookie: dono.cookie, corpo: { store_id: JARDIM, email: emailNovo, role: 'waiter' } });
const vinculoNovo = r.json?.store_user_id;
confere(r.status === 201 && /^[0-9a-f-]{36}$/.test(vinculoNovo ?? ''), 'dono convida um garçom', det(r));
// Quem ainda não aceitou recebe o convite de novo, no MESMO vínculo: o Auth reenvia e a
// function faz upsert. Só e-mail com conta confirmada é recusado.
r = await http('POST', '/api/admin/usuarios', { cookie: dono.cookie, corpo: { store_id: JARDIM, email: emailNovo, role: 'waiter' } });
confere(r.status === 201 && r.json?.store_user_id === vinculoNovo, 'convite repetido a quem não aceitou reenvia, no mesmo vínculo', det(r));
r = await http('POST', '/api/admin/usuarios', { cookie: dono.cookie, corpo: { store_id: JARDIM, email: 'garcom@jardim.local', role: 'manager' } });
confere(r.status === 409, 'convite para e-mail com conta confirmada responde 409', det(r));

let caixa = [];
const para = (email) => caixa.filter((msg) => (msg.To ?? []).some((t) => t.Address === email));
for (let tentativa = 0; tentativa < 10; tentativa++) {
  const m = await fetch(`${MAILPIT}/api/v1/messages?limit=100`).then((x) => x.json()).catch(() => null);
  caixa = m?.messages ?? [];
  if (para(emailNovo).length >= 2) break;
  await espera(500);
}
confere(para(emailNovo).length === 2, 'Mailpit recebeu os dois envios do convite', para(emailNovo).map((m) => m.Subject).join(' | ') || 'nenhum');
confere(para(emailDoGestor).length === 0, 'a tentativa do gestor não disparou e-mail');
confere(para('garcom@jardim.local').length === 0, 'o convite recusado não disparou e-mail');

r = await http('GET', `/api/admin/dados/usuarios?loja=${JARDIM}`, { cookie: dono.cookie });
const lista = Array.isArray(r.json) ? r.json : [];
const novo = lista.find((u) => u.email === emailNovo);
const vinculoDoDono = lista.find((u) => u.email === 'dono@jardim.local');
confere(novo?.role === 'waiter' && novo?.is_active === true && lista.filter((u) => u.email === emailNovo).length === 1, 'convidado aparece uma vez na lista, como garçom ativo', JSON.stringify(novo ?? null));
confere(lista.find((u) => u.email === 'garcom@jardim.local')?.role === 'waiter', 'o convite recusado não mudou o papel do garçom');
r = await http('POST', `/api/admin/usuarios/${novo?.id}`, { cookie: gestor.cookie, corpo: { acao: 'papel', role: 'manager' } });
confere(r.status === 403, 'gestor não muda papel', det(r));
r = await http('POST', `/api/admin/usuarios/${novo?.id}`, { cookie: dono.cookie, corpo: { acao: 'papel', role: 'manager' } });
confere(r.status === 200, 'dono promove o convidado a gestor', det(r));
r = await http('POST', `/api/admin/usuarios/${vinculoDoDono?.id}`, { cookie: dono.cookie, corpo: { acao: 'desativar' } });
confere([409, 422].includes(r.status), 'a loja nunca fica sem dono', det(r));
r = await http('POST', `/api/admin/usuarios/${novo?.id}`, { cookie: dono.cookie, corpo: { acao: 'desativar' } });
confere(r.status === 200, 'dono desativa o convidado', det(r));

// ============================================================
secao('11. Sair');
r = await http('POST', '/api/admin/sair', { cookie: gestor.cookie });
const cookiesApagados = (r.headers.getSetCookie?.() ?? []).filter((c) => /max-age=0|expires=thu, 01 jan 1970/i.test(c));
confere(r.status === 303 && (r.headers.get('location') ?? '').endsWith('/login') && cookiesApagados.length > 0, 'sair apaga os cookies e volta para /login', `HTTP ${r.status}, ${cookiesApagados.length} cookie(s) apagado(s)`);
r = await http('GET', '/api/admin/dados/contexto', { cookie: gestor.cookie });
confere(r.status === 401, 'o cookie antigo não vale depois de sair', det(r));

console.log(`\nRESULTADO: ${ok} passaram, ${falhas} falharam.`);
process.exit(falhas ? 1 : 0);
