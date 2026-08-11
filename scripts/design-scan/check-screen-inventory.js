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

function hasExport(relPath, exportName) {
  const src = readText(relPath);
  return new RegExp(`export\\s+function\\s+${exportName}\\s*\\(`).test(src) || new RegExp(`export\\s+const\\s+${exportName}\\s*=`).test(src);
}

function checkMappedModules(map, exportName, category) {
  const findings = [];
  for (const [mockFile, srcPath] of Object.entries(map)) {
    if (!fileExists(srcPath)) {
      findings.push({ level: 'error', category, mockFile, srcPath, message: `${mockFile} has no corresponding ${srcPath}` });
      continue;
    }
    if (!hasExport(srcPath, exportName)) {
      findings.push({ level: 'error', category, mockFile, srcPath, message: `${srcPath} does not export ${exportName}()` });
    }
  }
  return findings;
}

export function checkScreenInventory() {
  return checkMappedModules(SCREEN_MAP, 'mount', 'screen-inventory');
}

export function checkConsoleModeInventory() {
  const findings = checkMappedModules(CONSOLE_MODE_MAP, 'render', 'console-mode-inventory');
  for (const { label, srcPath, embeddedIn } of EMBEDDED_CONSOLE_MODES) {
    if (!fileExists(srcPath)) {
      findings.push({ level: 'error', category: 'console-mode-inventory', mockFile: `(embedded in ${embeddedIn})`, srcPath, message: `${label} console mode module ${srcPath} does not exist` });
    } else if (!hasExport(srcPath, 'render')) {
      findings.push({ level: 'error', category: 'console-mode-inventory', srcPath, message: `${srcPath} does not export render()` });
    }
  }
  return findings;
}