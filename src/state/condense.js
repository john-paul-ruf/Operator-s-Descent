import { hash } from '../core/hash.js';

let fields = null;
let tableVersion = null;

function fail(code) {
  const error = new RangeError(code);
  error.code = code;
  throw error;
}

function canonical(value) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail('invalid_symbol_value');
  return encoded;
}

function requireField(fieldName) {
  if (!fields) fail('condenser_uninitialized');
  const field = fields.get(fieldName);
  if (!field) fail('unknown_symbol_field');
  return field;
}

export function initCondenser(symbolTableData, hashValue = hash) {
  if (!symbolTableData || !Number.isInteger(symbolTableData.version) || symbolTableData.version < 1 || !symbolTableData.tables || typeof hashValue !== 'function') fail('invalid_symbol_table');
  const nextFields = new Map();
  for (const [fieldName, table] of Object.entries(symbolTableData.tables)) {
    if (!table || !Array.isArray(table.entries) || !Number.isInteger(table.width) || table.width < 1 || table.width > 32 || !Number.isInteger(table.escape) || table.escape < 0 || table.escape >= 2 ** table.width || table.entries.length > table.escape) fail('invalid_symbol_table');
    const candidates = new Map();
    const entries = table.entries.map((value) => ({ value, canonical: canonical(value) }));
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const key = hashValue(entry.canonical) >>> 0;
      const bucket = candidates.get(key) || [];
      bucket.push({ ...entry, index });
      candidates.set(key, bucket);
    }
    nextFields.set(fieldName, { candidates, entries, escape: table.escape, width: table.width, hashValue });
  }
  fields = nextFields;
  tableVersion = symbolTableData.version;
}

export function writeSymbol(writer, fieldName, value, writeRaw) {
  const field = requireField(fieldName);
  if (!writer || typeof writer.writeUint !== 'function' || typeof writeRaw !== 'function') fail('invalid_symbol_writer');
  const encoded = canonical(value);
  const candidates = field.candidates.get(field.hashValue(encoded) >>> 0) || [];
  const match = candidates.find((candidate) => candidate.canonical === encoded);
  writer.writeUint(match ? match.index : field.escape, field.width);
  if (!match) writeRaw(value, writer);
}

export function readSymbol(reader, fieldName, readRaw) {
  const field = requireField(fieldName);
  if (!reader || typeof reader.readUint !== 'function' || typeof readRaw !== 'function') fail('invalid_symbol_reader');
  const index = reader.readUint(field.width);
  if (index === field.escape) return readRaw(reader);
  if (index >= field.entries.length) fail('invalid_symbol_index');
  return field.entries[index].value;
}

export function getTableVersion() {
  if (tableVersion === null) fail('condenser_uninitialized');
  return tableVersion;
}

export function condense(runStateSerialized) {
  const data = new TextEncoder().encode(JSON.stringify(runStateSerialized));
  return { data, tableVersion: getTableVersion() };
}

export function expand(data, version) {
  if (version !== getTableVersion()) fail('version_mismatch');
  if (!(data instanceof Uint8Array)) fail('invalid_condensed_data');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
}
