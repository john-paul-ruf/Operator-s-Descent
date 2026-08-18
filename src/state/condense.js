import { hash } from '../core/hash.js';

const registry = new Map();
let currentVersion = null;

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

function buildFields(symbolTableData, hashValue) {
  const fields = new Map();
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
    fields.set(fieldName, { candidates, entries, escape: table.escape, width: table.width, hashValue });
  }
  return fields;
}

function validateTable(symbolTableData, hashValue) {
  if (!symbolTableData || !Number.isInteger(symbolTableData.version) || symbolTableData.version < 1 || !symbolTableData.tables || typeof hashValue !== 'function') fail('invalid_symbol_table');
}

export function registerCondenserTable(symbolTableData, hashValue = hash) {
  validateTable(symbolTableData, hashValue);
  registry.set(symbolTableData.version, buildFields(symbolTableData, hashValue));
}

export function initCondenser(symbolTableData, hashValue = hash) {
  registerCondenserTable(symbolTableData, hashValue);
  currentVersion = symbolTableData.version;
}

export function hasCondenserTable(version) {
  return registry.has(version);
}

function fieldsForVersion(version) {
  if (currentVersion === null) fail('condenser_uninitialized');
  const resolved = version ?? currentVersion;
  const fields = registry.get(resolved);
  if (!fields) fail('unknown_table_version');
  return fields;
}

function requireField(fieldName, version) {
  const fields = fieldsForVersion(version);
  const field = fields.get(fieldName);
  if (!field) fail('unknown_symbol_field');
  return field;
}

export function writeSymbol(writer, fieldName, value, writeRaw, version) {
  const field = requireField(fieldName, version);
  if (!writer || typeof writer.writeUint !== 'function' || typeof writeRaw !== 'function') fail('invalid_symbol_writer');
  const encoded = canonical(value);
  const candidates = field.candidates.get(field.hashValue(encoded) >>> 0) || [];
  const match = candidates.find((candidate) => candidate.canonical === encoded);
  writer.writeUint(match ? match.index : field.escape, field.width);
  if (!match) writeRaw(value, writer);
}

export function readSymbol(reader, fieldName, readRaw, version) {
  const field = requireField(fieldName, version);
  if (!reader || typeof reader.readUint !== 'function' || typeof readRaw !== 'function') fail('invalid_symbol_reader');
  const index = reader.readUint(field.width);
  if (index === field.escape) return readRaw(reader);
  if (index >= field.entries.length) fail('invalid_symbol_index');
  return field.entries[index].value;
}

export function getTableVersion() {
  if (currentVersion === null) fail('condenser_uninitialized');
  return currentVersion;
}

export function condense(runStateSerialized) {
  const data = new TextEncoder().encode(JSON.stringify(runStateSerialized));
  return { data, tableVersion: getTableVersion() };
}

export function expand(data, version) {
  if (currentVersion === null) fail('condenser_uninitialized');
  if (!registry.has(version)) fail('unknown_table_version');
  if (!(data instanceof Uint8Array)) fail('invalid_condensed_data');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
}
