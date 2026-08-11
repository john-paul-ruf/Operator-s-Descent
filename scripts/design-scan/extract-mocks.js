import { readText, listFiles, parseRootTokens, parseClassSelectors } from './lib.js';

const HUB_FILE = 'index.html';

export function listMockFiles() {
  return listFiles('mocks', '.html').filter((name) => name !== HUB_FILE);
}

function styleBlockOf(html) {
  return html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
}

export const extractMockRootTokens = parseRootTokens;

export function extractDeclaredClasses(html) {
  return parseClassSelectors(styleBlockOf(html));
}

export function extractModeTabLabels(html) {
  const tabPattern = /<(?:a|div)[^>]*class="mode-tab[^"]*"[^>]*>([^<]+)<\/(?:a|div)>/g;
  return [...html.matchAll(tabPattern)].map((match) => match[1].trim());
}

export function extractMinHeightValues(html) {
  const css = styleBlockOf(html);
  return [...css.matchAll(/min-height:\s*(\d+)px/g)].map((match) => Number(match[1]));
}

export function extractMock(fileName) {
  const html = readText(`mocks/${fileName}`);
  return {
    file: fileName,
    rootTokens: extractMockRootTokens(html),
    classes: extractDeclaredClasses(html),
    modeTabLabels: extractModeTabLabels(html),
    minHeightValues: extractMinHeightValues(html)
  };
}

export function extractAllMocks() {
  return listMockFiles().map(extractMock);
}