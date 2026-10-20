import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODEL_SCOPES } from '../../src/common/prisma/branch-scope.js';
import { connectOwner } from '../support/pg.js';
import { parsePrismaSchema } from '../support/parse-prisma-schema.js';
import type { SchemaField, SchemaModel } from '../support/parse-prisma-schema.js';

const { models, enums } = parsePrismaSchema();
const isRelation = (field: SchemaField): boolean => models.some((m) => m.name === field.type);
const columnsOf = (model: SchemaModel): SchemaField[] => model.fields.filter((f) => !isRelation(f));

describe('database matches prisma/schema.prisma', () => {
  let db: pg.Client;

  beforeAll(async () => {
    db = await connectOwner();
  });
  afterAll(async () => {
    await db.end();
  });

  it('declares 68 models and 25 enums', () => {
    expect(models).toHaveLength(68);
    expect(enums.size).toBe(25);
  });

  it('has a table for every model and no table without a model', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    );
    expect(rows.map((r) => r.tablename).sort()).toEqual(models.map((m) => m.table).sort());
  });

  it('has exactly the columns, nullability and enum types the models declare', async () => {
    const { rows } = await db.query<{
      table_name: string;
      column_name: string;
      is_nullable: string;
      udt_name: string;
    }>(
      "SELECT table_name, column_name, is_nullable, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' AND table_name NOT LIKE 'v\\_%'",
    );
    const actual = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r]));
    const expected = new Set<string>();
    for (const model of models) {
      for (const field of columnsOf(model)) {
        const key = `${model.table}.${field.column}`;
        expected.add(key);
        const column = actual.get(key);
        expect(column, `missing column ${key}`).toBeDefined();
        expect(column?.is_nullable === 'YES', `nullability of ${key}`).toBe(field.optional);
        if (enums.has(field.type)) expect(column?.udt_name, `enum type of ${key}`).toBe(field.type);
      }
    }
    expect([...actual.keys()].filter((key) => !expected.has(key))).toEqual([]);
  });

  it('has the enum values the schema declares', async () => {
    const { rows } = await db.query<{ typname: string; labels: string[] }>(
      `SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typnamespace = 'public'::regnamespace GROUP BY t.typname`,
    );
    expect(new Map(rows.map((r) => [r.typname, r.labels]))).toEqual(enums);
  });

  it('has the primary keys the models declare', async () => {
    const { rows } = await db.query<{ table_name: string; cols: string[] }>(
      `SELECT c.conrelid::regclass::text AS table_name,
              array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum)) AS cols
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.contype = 'p' AND c.connamespace = 'public'::regnamespace GROUP BY 1`,
    );
    const actual = new Map(rows.map((r) => [r.table_name.replaceAll('"', ''), r.cols]));
    for (const model of models) {
      const fieldNames = model.compositeId ?? model.fields.filter((f) => f.isId).map((f) => f.name);
      const columns = fieldNames.map((name) => model.fields.find((f) => f.name === name)!.column);
      expect(actual.get(model.table), `primary key of ${model.table}`).toEqual(columns);
    }
  });

  it('has every relationship as a foreign key to the right table and column', async () => {
    const { rows } = await db.query<{
      child: string;
      col: string;
      parent: string;
      parent_col: string;
    }>(
      `SELECT c.conrelid::regclass::text AS child, a.attname AS col, c.confrelid::regclass::text AS parent, fa.attname AS parent_col
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = c.confkey[1]
       WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`,
    );
    const actual = rows
      .map((r) => `${r.child}.${r.col}->${r.parent}.${r.parent_col}`.replaceAll('"', ''))
      .sort();
    const expected: string[] = [];
    for (const model of models) {
      for (const field of model.fields.filter((f) => f.relation)) {
        const target = models.find((m) => m.name === field.type)!;
        const fromColumn = model.fields.find((f) => f.name === field.relation!.fields[0])!.column;
        const toColumn = target.fields.find(
          (f) => f.name === field.relation!.references[0],
        )!.column;
        expected.push(`${model.table}.${fromColumn}->${target.table}.${toColumn}`);
      }
    }
    expect(expected).toHaveLength(163);
    expect(actual).toEqual(expected.sort());
  });

  it('enables row-level security on exactly the tables the application scope map covers', async () => {
    const { rows } = await db.query<{ relname: string }>(
      "SELECT relname FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relrowsecurity",
    );
    const scoped = models
      .filter((m) => m.name in MODEL_SCOPES)
      .map((m) => m.table)
      .sort();
    expect(scoped).toHaveLength(Object.keys(MODEL_SCOPES).length);
    expect(rows.map((r) => r.relname).sort()).toEqual(scoped);
  });

  it('has the row_version trigger on every table that carries a row_version column', async () => {
    const withColumn = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'row_version' AND table_name NOT LIKE 'v\\_%'",
    );
    const triggers = await db.query<{ relname: string }>(
      "SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND t.tgname LIKE '%\\_row\\_version'",
    );
    expect(triggers.rows.map((r) => r.relname).sort()).toEqual(
      withColumn.rows.map((r) => r.table_name).sort(),
    );
  });
});
