import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface SchemaField {
  name: string;
  column: string;
  type: string;
  optional: boolean;
  isId: boolean;
  isList: boolean;
  relation?: { fields: string[]; references: string[] };
}

export interface SchemaModel {
  name: string;
  table: string;
  fields: SchemaField[];
  compositeId: string[] | null;
}

export interface ParsedSchema {
  models: SchemaModel[];
  enums: Map<string, string[]>;
}

const SCHEMA_PATH = fileURLToPath(new URL('../../../../prisma/schema.prisma', import.meta.url));

function list(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parsePrismaSchema(
  source: string = readFileSync(SCHEMA_PATH, 'utf8'),
): ParsedSchema {
  const models: SchemaModel[] = [];
  const enums = new Map<string, string[]>();
  for (const block of source.matchAll(/^(model|enum) (\w+) \{\n([\s\S]*?)\n\}/gm)) {
    const [, kind, name, body] = block as unknown as [string, string, string, string];
    const lines = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//'));
    if (kind === 'enum') {
      enums.set(name, lines);
      continue;
    }
    const model: SchemaModel = { name, table: name, fields: [], compositeId: null };
    for (const line of lines) {
      const tableMap = /^@@map\("([^"]+)"\)/.exec(line);
      if (tableMap) {
        model.table = tableMap[1]!;
        continue;
      }
      const compositeId = /^@@id\(\[([^\]]+)\]\)/.exec(line);
      if (compositeId) {
        model.compositeId = list(compositeId[1]!);
        continue;
      }
      if (line.startsWith('@@')) continue;
      const match = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
      if (!match) continue;
      const [, fieldName, type, isList, optional, attributes = ''] = match;
      const relation = /@relation\([^)]*fields: \[([^\]]+)\], references: \[([^\]]+)\]/.exec(
        attributes,
      );
      model.fields.push({
        name: fieldName!,
        column: /@map\("([^"]+)"\)/.exec(attributes)?.[1] ?? fieldName!,
        type: type!,
        optional: Boolean(optional),
        isId: /@id\b/.test(attributes),
        isList: Boolean(isList),
        ...(relation
          ? { relation: { fields: list(relation[1]!), references: list(relation[2]!) } }
          : {}),
      });
    }
    models.push(model);
  }
  return { models, enums };
}
