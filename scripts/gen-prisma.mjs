// SQL 마이그레이션을 내장 Postgres(PGlite)에 적용한 뒤, 실제 테이블 구조를 읽어 prisma/schema.prisma 를 생성한다.
// (prisma db pull 과 같은 역할. 두 파일이 어긋나지 않게 하려는 목적)
// 사용: node scripts/gen-prisma.mjs [--check]
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const DIR = 'prisma/migrations';
const OUT = 'prisma/schema.prisma';

const pascal = (s) => s.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const camel = (s) => { const p = pascal(s); return p[0].toLowerCase() + p.slice(1); };
const singular = (t) => t.endsWith('ies') ? t.slice(0, -3) + 'y' : /(ch|sh|x|ss)es$/.test(t) ? t.slice(0, -2) : t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t;
const model = (t) => pascal(singular(t));

export async function generate() {
  const pg = new PGlite();
  for (const d of fs.readdirSync(DIR).sort()) await pg.exec(fs.readFileSync(`${DIR}/${d}/migration.sql`, 'utf8'));
  const q = async (s) => (await pg.query(s)).rows;

  const enums = {};
  for (const r of await q(`SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid ORDER BY t.typname, e.enumsortorder`)) (enums[r.typname] ||= []).push(r.enumlabel);

  const cols = await q(`SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`);
  const cons = await q(`SELECT c.conname, c.contype, r.relname AS tbl, fr.relname AS ftbl,
      (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(n,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n) AS cols,
      (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(n,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n) AS fcols
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid LEFT JOIN pg_class fr ON fr.oid=c.confrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND c.contype IN ('p','u','f') ORDER BY r.relname, c.conname`);
  const idx = await q(`SELECT t.relname AS tbl, i.relname AS name,
      (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(ix.indkey) WITH ORDINALITY k(n,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.n) AS cols
    FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND NOT ix.indisunique AND NOT ix.indisprimary ORDER BY t.relname, i.relname`);
  await pg.close();

  const tables = {};
  for (const c of cols) (tables[c.table_name] ||= { cols: [], back: [] }).cols.push(c);
  const of = (t, type) => cons.filter((c) => c.tbl === t && c.contype === type);
  const soleUnique = (t, col) => cons.some((c) => c.tbl === t && 'pu'.includes(c.contype) && c.cols.length === 1 && c.cols[0] === col);

  // 관계
  for (const fk of cons.filter((c) => c.contype === 'f')) {
    const [col] = fk.cols; const child = model(fk.tbl); const parent = model(fk.ftbl);
    const base = col.endsWith('_id') ? col.slice(0, -3) : col;
    const fwd = col.endsWith('_id') ? camel(base) : camel(col) + parent;
    const natural = base === singular(fk.ftbl);
    const oneToOne = soleUnique(fk.tbl, col);
    const stem = oneToOne ? camel(singular(fk.tbl)) : camel(fk.tbl);
    const back = natural ? stem : `${stem}As${pascal(base)}`;
    const name = `${child}_${camel(col)}`;
    const nullable = tables[fk.tbl].cols.find((c) => c.column_name === col).is_nullable === 'YES';
    (tables[fk.tbl].rel ||= []).push(`  ${fwd} ${parent}${nullable ? '?' : ''} @relation("${name}", fields: [${camel(col)}], references: [${camel(fk.fcols[0])}])`);
    tables[fk.ftbl].back.push(`  ${back} ${child}${oneToOne ? '?' : '[]'} @relation("${name}")`);
  }

  const typeOf = (c) => {
    if (c.data_type === 'USER-DEFINED') return pascal(c.udt_name);
    return { bigint: 'BigInt', integer: 'Int', text: 'String', boolean: 'Boolean', jsonb: 'Json',
      'timestamp with time zone': 'DateTime', date: 'DateTime' }[c.data_type] ?? (() => { throw new Error('미지원 타입 ' + c.data_type); })();
  };
  const defOf = (c) => {
    const d = c.column_default; if (d == null) return '';
    if (d.startsWith('nextval(')) return ' @default(autoincrement())';
    if (d === 'now()') return ' @default(now())';
    if (d === 'true' || d === 'false' || /^-?\d+$/.test(d)) return ` @default(${d})`;
    const m = /^'(.*)'::(.+)$/.exec(d);
    if (m) return c.data_type === 'USER-DEFINED' ? ` @default(${m[1]})` : ` @default(${JSON.stringify(m[1])})`;
    throw new Error(`미지원 기본값 ${c.table_name}.${c.column_name}: ${d}`);
  };

  let out = `// 이 파일은 scripts/gen-prisma.mjs 가 SQL 마이그레이션에서 생성한다. 직접 고치지 말고 SQL을 고친 뒤 다시 생성한다.
// CHECK 제약과 불변성 트리거는 Prisma로 표현할 수 없어 SQL(prisma/migrations)에만 있다.
// 금액 컬럼은 모두 원(KRW) 단위 BigInt.

// 데이터 모델 참조용. 서버는 SQL을 직접 사용한다(src/server/db.ts).

datasource db {
  provider = "postgresql"
}
`;
  for (const [name, vals] of Object.entries(enums)) out += `\nenum ${pascal(name)} {\n${vals.map((v) => `  ${v}`).join('\n')}\n\n  @@map("${name}")\n}\n`;

  for (const [t, def] of Object.entries(tables)) {
    const pk = of(t, 'p')[0]; const uniques = of(t, 'u');
    out += `\nmodel ${model(t)} {\n`;
    for (const c of def.cols) {
      const f = camel(c.column_name);
      let line = `  ${f} ${typeOf(c)}${c.is_nullable === 'YES' ? '?' : ''}`;
      if (pk.cols.length === 1 && pk.cols[0] === c.column_name) line += ' @id';
      if (uniques.some((u) => u.cols.length === 1 && u.cols[0] === c.column_name)) line += ' @unique';
      line += defOf(c);
      if (c.data_type === 'timestamp with time zone') line += ' @db.Timestamptz(6)';
      if (c.data_type === 'date') line += ' @db.Date';
      if (f !== c.column_name) line += ` @map("${c.column_name}")`;
      out += line + '\n';
    }
    const rels = [...(def.rel || []), ...def.back];
    if (rels.length) out += '\n' + rels.join('\n') + '\n';
    out += '\n';
    if (pk.cols.length > 1) out += `  @@id([${pk.cols.map(camel).join(', ')}])\n`;
    for (const u of uniques.filter((u) => u.cols.length > 1)) out += `  @@unique([${u.cols.map(camel).join(', ')}])\n`;
    for (const i of idx.filter((i) => i.tbl === t)) out += `  @@index([${i.cols.map(camel).join(', ')}], map: "${i.name}")\n`;
    out += `  @@map("${t}")\n}\n`;
  }
  return out;
}

if (process.argv[1].endsWith('gen-prisma.mjs')) {
  const text = await generate();
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(OUT, 'utf8') !== text) { console.error('schema.prisma 가 SQL과 다릅니다. node scripts/gen-prisma.mjs 로 다시 생성하세요.'); process.exit(1); }
    console.log('schema.prisma 가 SQL과 일치합니다.');
  } else { fs.writeFileSync(OUT, text); console.log(`${OUT} 생성 완료`); }
}
