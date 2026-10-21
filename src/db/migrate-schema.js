// src/db/migrate-schema.js
// Schema-snapshot based migration runner (SEPARATE from src/utils/migrate.js, which stays as-is).
//
// Source of truth: src/db/schema.snapshot.json  (exported from the live Azure SQL DB, 64 tables:
// columns, types, identity, defaults, computed cols, PK/unique/indexes, FKs, check constraints).
//
// Run:
//   node src/db/migrate-schema.js --dry              -> only print the SQL, no DB connection
//   node src/db/migrate-schema.js                    -> apply to the DB from .env
//   node src/db/migrate-schema.js --only=users,schools   -> limit to some tables
//
// Rules: ADDITIVE and IDEMPOTENT only. It never drops/alters/renames anything.
//  - missing table  -> CREATE TABLE (cols, defaults, PK, unique constraints)
//  - missing column -> ALTER TABLE ADD
//  - missing index / check / FK (matched by name) -> created
//  - a column whose type/nullability differs from the snapshot is NOT changed (do that by hand).
// Safe to run many times, on an empty DB (fresh setup) or on the existing prod DB (no-op).
//
// To add a new table/column in future: change the DB (or edit schema.snapshot.json), keep the snapshot
// in sync, run this script.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) : null;

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema.snapshot.json'), 'utf8'));
const tables = snapshot.filter((t) => !ONLY || ONLY.has(t.table.toLowerCase()));

const q = (n) => `[${String(n).replace(/]/g, ']]')}]`;
const lit = (s) => `N'${String(s).replace(/'/g, "''")}'`;
const full = (t) => `${q(t.schema)}.${q(t.table)}`;

function typeSql(c) {
  const len = (n) => (n === -1 ? 'MAX' : n);
  switch (c.data_type) {
    case 'nvarchar': case 'varchar': case 'nchar': case 'char':
    case 'varbinary': case 'binary':
      return `${c.data_type}(${len(c.max_length)})`;
    case 'decimal': case 'numeric': return `${c.data_type}(${c.precision},${c.scale})`;
    case 'datetime2': case 'datetimeoffset': case 'time': return `${c.data_type}(${c.scale})`;
    default: return c.data_type; // int, bigint, bit, date, datetime, uniqueidentifier, tinyint, smallint, ...
  }
}

// forAdd = ALTER TABLE ADD on a table that may already hold rows
function colSql(t, c, forAdd = false) {
  if (c.computed_def) return `${q(c.name)} AS ${c.computed_def}`;
  let nullable = c.is_nullable;
  if (forAdd && !nullable && !c.default_def && !c.is_identity) {
    nullable = true; // NOT NULL w/o default cannot be added to a table with rows (backfill, then tighten by hand)
  }
  let s = `${q(c.name)} ${typeSql(c)}`;
  if (c.is_identity) s += ` IDENTITY(${c.identity_seed || 1},${c.identity_incr || 1})`;
  s += nullable ? ' NULL' : ' NOT NULL';
  if (c.default_def) s += ` CONSTRAINT ${q(c.default_name || `DF_${t.table}_${c.name}`)} DEFAULT ${c.default_def}`;
  return s;
}

const idxCols = (ix, included) =>
  ix.cols.filter((c) => !!c.is_included === included)
    .sort((a, b) => a.key_ordinal - b.key_ordinal)
    .map((c) => (included ? q(c.name) : `${q(c.name)} ${c.is_desc ? 'DESC' : 'ASC'}`)).join(', ');

function createTableSql(t) {
  const lines = t.columns.slice().sort((a, b) => a.column_id - b.column_id).map((c) => colSql(t, c));
  const pk = t.indexes.find((i) => i.is_primary_key);
  if (pk) lines.push(`CONSTRAINT ${q(pk.name)} PRIMARY KEY ${pk.type_desc} (${idxCols(pk, false)})`);
  t.indexes.filter((i) => i.is_unique_constraint && !i.is_primary_key)
    .forEach((u) => lines.push(`CONSTRAINT ${q(u.name)} UNIQUE ${u.type_desc} (${idxCols(u, false)})`));
  return `IF OBJECT_ID(N'${full(t)}', N'U') IS NULL\nCREATE TABLE ${full(t)} (\n  ${lines.join(',\n  ')}\n)`;
}

const addColumnSql = (t, c) =>
  `IF COL_LENGTH(N'${full(t)}', ${lit(c.name)}) IS NULL\nALTER TABLE ${full(t)} ADD ${colSql(t, c, true)}`;

function indexSql(t, ix) {
  const guard = `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = ${lit(ix.name)} AND object_id = OBJECT_ID(N'${full(t)}'))`;
  const pkClustered = t.indexes.some((i) => i.is_primary_key && i.type_desc === 'CLUSTERED');
  const kind = ix.type_desc === 'CLUSTERED' && pkClustered ? 'NONCLUSTERED' : ix.type_desc;
  if (ix.is_unique_constraint) {
    return `${guard}\nALTER TABLE ${full(t)} ADD CONSTRAINT ${q(ix.name)} UNIQUE ${kind} (${idxCols(ix, false)})`;
  }
  const inc = idxCols(ix, true);
  return `${guard}\nCREATE ${ix.is_unique ? 'UNIQUE ' : ''}${kind} INDEX ${q(ix.name)} ON ${full(t)} (${idxCols(ix, false)})` +
    `${inc ? ` INCLUDE (${inc})` : ''}${ix.filter_definition ? ` WHERE ${ix.filter_definition}` : ''}`;
}

const checkSql = (t, ck) =>
  `IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = ${lit(ck.name)} AND parent_object_id = OBJECT_ID(N'${full(t)}'))\n` +
  `ALTER TABLE ${full(t)} ADD CONSTRAINT ${q(ck.name)} CHECK ${ck.definition}`;

function fkSql(t, fk) {
  const act = (a) => String(a || 'NO_ACTION').replace(/_/g, ' ');
  return `IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = ${lit(fk.name)} AND parent_object_id = OBJECT_ID(N'${full(t)}'))\n` +
    `ALTER TABLE ${full(t)} ADD CONSTRAINT ${q(fk.name)} FOREIGN KEY (${fk.cols.map((c) => q(c.col)).join(', ')}) ` +
    `REFERENCES ${q(fk.ref_schema)}.${q(fk.ref_table)} (${fk.cols.map((c) => q(c.ref_col)).join(', ')}) ` +
    `ON DELETE ${act(fk.on_delete)} ON UPDATE ${act(fk.on_update)}`;
}

// order: tables -> missing columns -> indexes -> checks -> foreign keys (FKs last so table order never matters)
function buildPlan() {
  const plan = [];
  const add = (label, sqlText) => plan.push({ label, sqlText });
  tables.forEach((t) => add(`table ${t.table}`, createTableSql(t)));
  tables.forEach((t) => t.columns.forEach((c) => add(`column ${t.table}.${c.name}`, addColumnSql(t, c))));
  tables.forEach((t) => t.indexes.filter((i) => !i.is_primary_key).forEach((i) => add(`index ${i.name}`, indexSql(t, i))));
  tables.forEach((t) => t.checks.forEach((c) => add(`check ${c.name}`, checkSql(t, c))));
  tables.forEach((t) => t.foreign_keys.forEach((f) => add(`fk ${f.name}`, fkSql(t, f))));
  return plan;
}

async function main() {
  const plan = buildPlan();

  if (DRY) {
    console.log(plan.map((p) => `-- ${p.label}\n${p.sqlText};\nGO`).join('\n\n'));
    console.log(`\n-- ${plan.length} statements for ${tables.length} tables (dry run, nothing executed)`);
    return;
  }

  require('dotenv').config();
  const { getPool } = require('../config/db');
  const logger = require('../utils/logger');
  const pool = await getPool();
  let ok = 0; let failed = 0;
  for (const p of plan) {
    try {
      await pool.request().query(p.sqlText);
      ok++;
    } catch (err) {
      failed++;
      logger.error(`  ❌ ${p.label} FAILED: ${err.message}`);
    }
  }
  logger.info(`🎉 Schema migration done: ${ok} ok, ${failed} failed (${tables.length} tables, ${plan.length} statements)`);
  await pool.close().catch(() => {});
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('Schema migration error:', err); process.exit(1); });
