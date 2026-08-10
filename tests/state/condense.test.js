import { describe, it, expect } from 'vitest';
import { createBitReader, createBitWriter } from '../../src/state/bit-codec.js';
import { expand, getTableVersion, initCondenser, readSymbol, writeSymbol } from '../../src/state/condense.js';
import { loadData } from '../helpers/data.js';

const symbolTable = loadData('symbol-table');

function roundTrip(fieldName, value, writeRaw = () => {}, readRaw = () => 'raw') {
  const writer = createBitWriter();
  writeSymbol(writer, fieldName, value, writeRaw);
  return readSymbol(createBitReader(writer.toUint8Array(), writer.bitLength), fieldName, readRaw);
}

describe('condense — field symbols', () => {
  it('initializes the committed symbol table and exposes its version', () => {
    initCondenser(symbolTable);
    expect(getTableVersion()).toBe(symbolTable.version);
  });

  it('encodes and decodes every committed entry', () => {
    initCondenser(symbolTable);
    for (const [fieldName, table] of Object.entries(symbolTable.tables)) {
      for (const value of table.entries) expect(roundTrip(fieldName, value)).toEqual(value);
    }
  });

  it('writes the field escape and losslessly reads rare legal values', () => {
    initCondenser(symbolTable);
    const writer = createBitWriter();
    writeSymbol(writer, 'hp', 255, (value, target) => target.writeVarUint(value));
    const reader = createBitReader(writer.toUint8Array(), writer.bitLength);
    expect(reader.readUint(symbolTable.tables.hp.width)).toBe(symbolTable.tables.hp.escape);
    expect(reader.readVarUint()).toBe(255);
    expect(roundTrip('sigil_id', 'pua-f8ff', (value, target) => target.writeVarUint(value.length), (source) => 'pua-f8ff')).toBe('pua-f8ff');
  });

  it('rejects malformed table indexes and incompatible table versions', () => {
    initCondenser(symbolTable);
    const writer = createBitWriter();
    writer.writeUint(symbolTable.tables.class.entries.length, symbolTable.tables.class.width);
    expect(() => readSymbol(createBitReader(writer.toUint8Array(), writer.bitLength), 'class', () => null)).toThrow('invalid_symbol_index');
    expect(() => expand(new Uint8Array(), symbolTable.version + 1)).toThrow('version_mismatch');
  });

  it('compares canonical values after hash lookup collisions', () => {
    initCondenser({ version: 1, tables: { test: { width: 2, escape: 3, entries: ['first', 'second'] } } }, () => 0);
    expect(roundTrip('test', 'second')).toBe('second');
    expect(roundTrip('test', 'third', (value, target) => target.writeVarUint(value.length), () => 'third')).toBe('third');
  });
});
