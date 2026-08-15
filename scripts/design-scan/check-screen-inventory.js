import { fileExists, readText } from './lib.js';

const SCREEN_MAP = {
  'title.html': 'src/ui/screens/title.js',
  'creation.html': 'src/ui/screens/creation.js',
  'exploration.html': 'src/ui/screens/exploration.js',
  'combat.html': 'src/ui/screens/combat.js',
  'library.html': 'src/ui/screens/library.js',
  'scorecard.html': 'src/ui/screens/scorecard.js',
  'import.html': 'src/ui/screens/import.js',
  'tutorial.html': 'src/ui/screens/tutorial.js',
  'settings.html': 'src/ui/screens/settings.js'
};

const CONSOLE_MODE_MAP = {
  'console-party.html': 'src/ui/console/party.js',
  'console-gear.html': 'src/ui/console/gear.js',
  'console-tech.html': 'src/ui/console/tech.js',
  'console-loot.html': 'src/ui/console/loot.js',
  'console-log.html': 'src/ui/console/log.js'
};

const EMBEDDED_CONSOLE_MODES = [
  { label: 'MOVE', srcPath: 'src/ui/console/move.js', embeddedIn: 'exploration.html' },
  { label: 'COMBAT', srcPath: 'src/ui/console/combat.js', embeddedIn: 'combat.html' }
];

// Wide expectation table: 14 wide mock files (no index.html). Missing wide mock → warning,
// labelled `[wide — unimplemented]`. Wide layout has no production src target yet; the follow-up
// implementation feature will introduce prod modules and flip the warnings to errors.
const WIDE_MOCK_FILES = [
  ...Object.keys(SCREEN_MAP),
  ...Object.keys(CONSOLE_MODE_MAP),
  ...EMBEDDED_CONSOLE_MODES.map((e) => e.embeddedIn)
].sort();

function hasExport(relPath, exportName) {
  const src = readText(relPath);
  return new RegExp(`export\\s+function\\s+${exportName}\\s*\\(`).test(src) || new RegExp(`export\\s+const\\s+${exportName}\\s*=`).test(src);
}

function checkMappedModules(map, exportName, category) {
  const findings = [];
  for (const [mockFile, srcPath] of Object.entries(map)) {
    if (!fileExists(srcPath)) {
      findings.push({ level: 'error', category, layout: 'portrait', mockFile, srcPath, message: `${mockFile} has no corresponding ${srcPath}` });
      continue;
    }
    if (!hasExport(srcPath, exportName)) {
      findings.push({ level: 'error', category, layout: 'portrait', mockFile, srcPath, message: `${srcPath} does not export ${exportName}()` });
    }
  }
  return findings;
}

function checkWideMockFilesPresent(category) {
  const findings = [];
  const seen = new Set();
  for (const file of WIDE_MOCK_FILES) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (!fileExists(`mocks/wide/${file}`)) {
      findings.push({
        level: 'warning',
        category,
        layout: 'wide',
        mockFile: file,
        message: `[wide — unimplemented] mocks/wide/${file} is missing (expected in the wide layout class)`
      });
    }
  }
  return findings;
}

export function checkScreenInventory() {
  return [
    ...checkMappedModules(SCREEN_MAP, 'mount', 'screen-inventory'),
    ...checkWideMockFilesPresent('screen-inventory').filter((f) => Object.keys(SCREEN_MAP).includes(f.mockFile))
  ];
}

export function checkConsoleModeInventory() {
  const findings = checkMappedModules(CONSOLE_MODE_MAP, 'render', 'console-mode-inventory');
  for (const { label, srcPath, embeddedIn } of EMBEDDED_CONSOLE_MODES) {
    if (!fileExists(srcPath)) {
      findings.push({ level: 'error', category: 'console-mode-inventory', layout: 'portrait', mockFile: `(embedded in ${embeddedIn})`, srcPath, message: `${label} console mode module ${srcPath} does not exist` });
    } else if (!hasExport(srcPath, 'render')) {
      findings.push({ level: 'error', category: 'console-mode-inventory', layout: 'portrait', srcPath, message: `${srcPath} does not export render()` });
    }
  }
  const consoleAndEmbeddedFiles = new Set([
    ...Object.keys(CONSOLE_MODE_MAP),
    ...EMBEDDED_CONSOLE_MODES.map((e) => e.embeddedIn)
  ]);
  findings.push(
    ...checkWideMockFilesPresent('console-mode-inventory').filter((f) => consoleAndEmbeddedFiles.has(f.mockFile))
  );
  return findings;
}
