// ScratchJr's three tables, as the browser's local copy names them, and the
// Prisma model and field each column is kept in. This is the whole of what a
// browser may write: anything else in a sync request is refused.

const text = (field, max = 10000) => ({field, type: 'text', max});
const int = field => ({field, type: 'int'});

export const TABLES = {
  PROJECTS: {
    model: 'project',
    columns: {
      CTIME: text('ctime'),
      MTIME: text('mtime'),
      ALTMD5: text('altmd5'),
      POS: int('pos'),
      NAME: text('name', 200),
      // Every page, character and script of a project lives in this one column.
      JSON: text('json', 8 * 1024 * 1024),
      THUMBNAIL: text('thumbnail'),
      OWNER: text('owner'),
      GALLERY: text('gallery'),
      DELETED: text('deleted'),
      VERSION: text('version'),
      ISGIFT: int('isgift'),
    },
  },
  USERSHAPES: {
    model: 'shape',
    columns: {
      CTIME: text('ctime'),
      MD5: text('md5'),
      ALTMD5: text('altmd5'),
      WIDTH: text('width'),
      HEIGHT: text('height'),
      EXT: text('ext'),
      NAME: text('name', 200),
      OWNER: text('owner'),
      SCALE: text('scale'),
      VERSION: text('version'),
    },
  },
  USERBKGS: {
    model: 'background',
    columns: {
      CTIME: text('ctime'),
      MD5: text('md5'),
      ALTMD5: text('altmd5'),
      WIDTH: text('width'),
      HEIGHT: text('height'),
      EXT: text('ext'),
      OWNER: text('owner'),
      VERSION: text('version'),
    },
  },
};

// Prisma's Int is 32-bit.
export const MAX_ID = 2147483647;

// A file name as ScratchJr makes them: an MD5 or project-prefixed MD5, plus an
// extension. Nothing that could be a path.
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}$/;
export const MAX_FILE_CHARS = 25 * 1024 * 1024;

export function fileNameProblem(name) {
  if (typeof name !== 'string' || !FILE_NAME.test(name) || name.includes('..')) return 'Not a ScratchJr file name.';
  return null;
}

function convert(spec, value, column) {
  if (value === null || value === undefined) return null;
  if (spec.type === 'int') {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isInteger(number) || Math.abs(number) > MAX_ID) throw new Error(`${column} must be a whole number.`);
    return number;
  }
  // SQLite hands back a number for a numeric-looking value in a DATETIME or
  // TEXT column, so numbers are accepted and kept as text.
  const string = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof string !== 'string') throw new Error(`${column} must be text.`);
  if (string.length > spec.max) throw new Error(`${column} is too long.`);
  return string;
}

// One row from the browser, as Prisma data. Throws on anything unexpected.
export function rowToData(table, row) {
  const definition = TABLES[table];
  if (!definition) throw new Error(`Unknown table ${table}.`);
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('A row must be an object.');
  const data = {};
  for (const [column, value] of Object.entries(row)) {
    if (column === 'ID') continue;
    const spec = definition.columns[column];
    if (!spec) throw new Error(`${table} has no column ${column}.`);
    data[spec.field] = convert(spec, value, column);
  }
  return data;
}

// One stored record, back in the shape ScratchJr's table has.
export function dataToRow(table, record) {
  const row = {ID: record.localId};
  for (const [column, spec] of Object.entries(TABLES[table].columns)) row[column] = record[spec.field] ?? null;
  return row;
}

export function idProblem(id) {
  return Number.isInteger(id) && id > 0 && id <= MAX_ID ? null : 'Row IDs must be positive whole numbers.';
}
