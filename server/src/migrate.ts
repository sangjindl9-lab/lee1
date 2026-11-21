import { createPool, migrateUp, migrateDownOne } from './db.js';
const db = createPool();
if (process.argv[2] === 'down') console.log('rolled back:', await migrateDownOne(db));
else console.log('applied:', await migrateUp(db));
await db.end();
