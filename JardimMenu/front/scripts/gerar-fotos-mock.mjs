// Fotos do cardápio de exemplo (lib/mock/menu.ts).
//
//   node scripts/gerar-fotos-mock.mjs <pasta-com-as-originais>
//
// A pasta tem um arquivo por produto, com o nome da chave do exemplo: p01.png, p02.jpg...
// As originais não entram no repositório. Entram só as três larguras em WebP, com as
// mesmas regras do upload real (back/controllers/fotos.ts, §18.4): proporção 4:3, recorte
// no que tem mais detalhe e teto de tamanho por largura. Assim o exemplo pesa no tablet o
// mesmo que a foto de verdade pesaria.
//
// São fotos ilustrativas, geradas por IA, só para o exemplo. Em produção, a foto é a do
// prato real, enviada pelo admin.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const FRONT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DESTINO = path.join(FRONT, 'public', 'mock', 'produtos');
const ORIGEM = process.argv[2];

const MENOR_LADO = 800;
const PROPORCAO = 4 / 3;
const LARGURAS = [
  { nome: 'grade', largura: 400, teto: 45 * 1024 },
  { nome: 'vitrine', largura: 600, teto: 70 * 1024 },
  { nome: 'modal', largura: 900, teto: 120 * 1024 },
];

if (!ORIGEM || !fs.existsSync(ORIGEM)) {
  console.error('Uso: node scripts/gerar-fotos-mock.mjs <pasta-com-as-originais>');
  process.exit(2);
}

async function webpNoTeto(entrada, largura, teto) {
  for (let qualidade = 82; qualidade >= 40; qualidade -= 6) {
    const saida = await sharp(entrada)
      .rotate()
      .resize({ width: largura, height: Math.round(largura / PROPORCAO), fit: 'cover', position: 'attention' })
      .webp({ quality: qualidade })
      .toBuffer();
    if (saida.length <= teto) return { saida, qualidade };
  }
  return null;
}

const originais = fs
  .readdirSync(ORIGEM)
  .filter((nome) => /^p\d{2}\.(png|jpe?g|webp)$/i.test(nome))
  .sort();

let falhas = 0;
for (const nome of originais) {
  const chave = nome.slice(0, 3).toLowerCase();
  const entrada = fs.readFileSync(path.join(ORIGEM, nome));
  const { width = 0, height = 0 } = await sharp(entrada).rotate().metadata();
  if (Math.min(width, height) < MENOR_LADO) {
    console.log(`  FALHA ${chave}: ${width}x${height}, menor lado abaixo de ${MENOR_LADO} px`);
    falhas++;
    continue;
  }

  const pasta = path.join(DESTINO, chave);
  fs.mkdirSync(pasta, { recursive: true });
  const tamanhos = [];
  for (const alvo of LARGURAS) {
    const r = await webpNoTeto(entrada, alvo.largura, alvo.teto);
    if (!r) {
      console.log(`  FALHA ${chave}: não coube em ${alvo.teto / 1024} KB na largura ${alvo.largura}`);
      falhas++;
      break;
    }
    fs.writeFileSync(path.join(pasta, `${alvo.nome}.webp`), r.saida);
    tamanhos.push(`${alvo.nome} ${(r.saida.length / 1024).toFixed(1)} KB (q${r.qualidade})`);
  }
  if (tamanhos.length === LARGURAS.length) console.log(`  ok    ${chave} ${width}x${height} -> ${tamanhos.join(', ')}`);
}

console.log(`\n${originais.length} originais, ${falhas} falha(s). Destino: ${path.relative(FRONT, DESTINO)}`);
process.exit(falhas ? 1 : 0);
