// schema.prisma 를 Prisma 공식 검증기(WASM)로 검사한다. Prisma CLI 엔진을 내려받을 수 없는 환경에서도 동작한다.
import fs from 'node:fs';
import wasm from '@prisma/prisma-schema-wasm';
const prismaSchema = fs.readFileSync('prisma/schema.prisma', 'utf8');
try {
  wasm.validate(JSON.stringify({ prismaSchema, noColor: true }));
  const d = JSON.parse(wasm.get_dmmf(JSON.stringify({ prismaSchema, noColor: true })));
  console.log(`schema.prisma 유효: 모델 ${d.datamodel.models.length}개, 열거형 ${d.datamodel.enums.length}개`);
} catch (e) { console.error(String(e.message || e)); process.exit(1); }
