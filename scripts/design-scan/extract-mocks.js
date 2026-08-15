import { readText, listFiles, parseRootTokens, parseClassSelectors } from './lib.js';

const HUB_FILE = 'index.html';
const PORTRAIT_DIR = 'mocks';
const WIDE_DIR = 'mocks/wide';

export const LAYOUT_CLASSES = ['portrait', 'wide'];

function mockDir(layout) {
  return layout === 'wide' ? WIDE_DIR : PORTRAIT_DIR;
}

export function listMockFiles() {
  return listFiles(PORTRAIT_DIR, '.html').filter((name) => name !== HUB_FILE);
}

export function listWideMockFiles() {
  return listFiles(WIDE_DIR, '.html');
}

export function listAllMockFilesByLayout() {
  return [
    ...listMockFiles().map((file) => ({ file, layout: 'portrait' })),
    ...listWideMockFiles().map((file) => ({ file, layout: 'wide' }))
  ];
}

function styleBlockOf(html) {
  return html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
}

export const extractMockRootTokens = parseRootTokens;

export function extractDeclaredClasses(html) {
  return parseClassSelectors(styleBlockOf(html).replace(/\/\*[\s\S]*?\*\//g, ''));
}

export function extractModeTabLabels(html) {
  const tabPattern = /<(?:a|div)[^>]*class="(?:wide-)?mode-tab[^"]*"[^>]*>([^<]+)<\/(?:a|div)>/g;
  return [...html.matchAll(tabPattern)].map((match) => match[1].trim());
}

export function extractMinHeightValues(html) {
  const css = styleBlockOf(html);
  return [...css.matchAll(/min-height:\s*(\d+)px/g)].map((match) => Number(match[1]));
}

export function extractMock(fileName, layout = 'portrait') {
  const html = readText(`${mockDir(layout)}/${fileName}`);
  return {
    file: fileName,
    layout,
    rootTokens: extractMockRootTokens(html),
    classes: extractDeclaredClasses(html),
    modeTabLabels: extractModeTabLabels(html),
    minHeightValues: extractMinHeightValues(html)
  };
}

export function extractAllMocks() {
  return listMockFiles().map((file) => extractMock(file, 'portrait'));
}

export function extractAllWideMocks() {
  return listWideMockFiles().map((file) => extractMock(file, 'wide'));
}

export function extractAllMocksAcrossLayouts() {
  return [...extractAllMocks(), ...extractAllWideMocks()];
}
