import { hash } from '../core/hash.js';

let tables = null;
let tableVersion = null;

export function initCondenser(symbolTableData) {
  tables = new Map();
  tableVersion = symbolTableData.version;
  for (const [fieldName, table] of Object.entries(symbolTableData.tables)) {
    const forward = new Map();
    for (let i = 0; i < table.entries.length; i++) {
      const key = JSON.stringify(table.entries[i]);
      forward.set(key, i);
    }
    tables.set(fieldName, { forward, reverse: table.entries, escape: table.escape });
  }
}

export function condense(runStateSerialized) {
  const json = JSON.stringify(runStateSerialized);
  const bytes = new Uint8Array(json.length);
  for (let i = 0; i < json.length; i++) bytes[i] = json.charCodeAt(i);
  return { data: bytes, tableVersion: tableVersion || 1 };
}

export function expand(data, tableVersion) {
  let str = '';
  for (let i = 0; i < data.length; i++) str += String.fromCharCode(data[i]);
  return JSON.parse(str);
}