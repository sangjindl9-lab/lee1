import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';
import { SvgConverter } from '../node_modules/@mlightcad/libredwg-web/lib/svg/svgConverter.js';
import { readFileSync, writeFileSync } from 'node:fs';
const bytes = readFileSync(process.argv[2]);
const lib = await LibreDwg.create();
const t0 = Date.now();
const ptr = lib.dwg_read_data(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), Dwg_File_Type.DWG);
console.log('ptr', ptr, 'read ms', Date.now() - t0);
const db = lib.convert(ptr);
console.log('version', db.header?.ACADVER, 'INSUNITS', db.header?.INSUNITS, 'entities', db.entities.length, 'blocks', db.tables.BLOCK_RECORD.entries.length, 'layers', db.tables.LAYER.entries.length);
const types = {}; for (const e of db.entities) types[e.type] = (types[e.type] || 0) + 1; console.log(types);
const ms = db.tables.BLOCK_RECORD.entries.find(b => /model_space/i.test(b.name)); console.log('model space', ms && ms.name, ms && ms.entities?.length);
const conv = new SvgConverter(); const orig = conv.entityToBoundsAndElement.bind(conv); let errs = {}; conv.entityToBoundsAndElement = (e) => { try { return orig(e); } catch (err) { errs[e.type + ': ' + err.message] = (errs[e.type + ': ' + err.message] || 0) + 1; return null; } };
const t1 = Date.now(); const svg = conv.convert(db); console.log('svg ms', Date.now() - t1, 'len', svg.length, 'viewBox', svg.match(/viewBox="([^"]+)"/)?.[1]); console.log('errors', errs);
writeFileSync('/tmp/dwgtest/out.svg', svg);
for (const b of db.tables.BLOCK_RECORD.entries) { const t = {}; for (const e of b.entities || []) t[e.type] = (t[e.type] || 0) + 1; console.log('block', b.name, (b.entities || []).length, JSON.stringify(t).slice(0, 150)); }
for (const e of db.entities.filter(e => e.type === 'INSERT')) console.log('INSERT', e.name, JSON.stringify(e.insertionPoint), e.xScale, e.yScale, e.rotation, 'layer', e.layer);
const pts = []; for (const e of db.entities) { if (e.startPoint) pts.push(e.startPoint); if (e.endPoint) pts.push(e.endPoint); if (e.center) pts.push(e.center); if (e.vertices) pts.push(...e.vertices); if (e.startPoint === undefined && e.insertionPoint) pts.push(e.insertionPoint); }
const xs = pts.map(p => p.x), ys = pts.map(p => p.y); console.log('extent x', Math.min(...xs), Math.max(...xs), 'y', Math.min(...ys), Math.max(...ys));
console.log('texts', db.entities.filter(e => e.type === 'TEXT').slice(0, 8).map(e => e.text + '@' + JSON.stringify(e.startPoint)).join(' | '));
for (const b of db.tables.BLOCK_RECORD.entries) if (/xr-|평면선형/.test(b.name)) console.log('XREF?', JSON.stringify(Object.fromEntries(Object.entries(b).filter(([k,v])=>typeof v!=='object'))).slice(0,400));
