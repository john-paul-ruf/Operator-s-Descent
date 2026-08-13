import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MOCKS_DIR = join(ROOT, 'mocks');
const DEFAULT_SHOTS_DIR = join(ROOT, 'program', 'operator-s-descent', 'prompts', 'visual-parity-v3', 'shots');
const SERVER_URL = `http://127.0.0.1:${process.env.PORT || 8080}/`;
const DEFAULT_VIEWPORT = { width: 600, height: 900 };

const SCREENS = {
  title:           { mockFile: 'title.html',          setup: null },
  creation:        { mockFile: 'creation.html',       setup: 'clickStart' },
  exploration:     { mockFile: 'exploration.html',    setup: 'startRunToExploration' },
  combat:          { mockFile: 'combat.html',         setup: 'startRunToCombat' },
  'console-party': { mockFile: 'console-party.html',  setup: 'openConsoleTab:party' },
  'console-tech':  { mockFile: 'console-tech.html',   setup: 'openConsoleTab:tech' },
  'console-gear':  { mockFile: 'console-gear.html',   setup: 'openConsoleTab:gear' },
  'console-loot':  { mockFile: 'console-loot.html',   setup: 'openConsoleTab:loot' },
  'console-log':   { mockFile: 'console-log.html',    setup: 'openConsoleTab:log' },
  'console-move':  { mockFile: 'console-log.html',    setup: 'openConsoleTab:move' },
  library:         { mockFile: 'library.html',        setup: 'navigateToLibrary' },
  scorecard:       { mockFile: 'scorecard.html',      setup: 'skip' },
  import:          { mockFile: 'import.html',         setup: 'navigateToImport' },
  tutorial:        { mockFile: 'tutorial.html',       setup: 'navigateToTutorial' },
  settings:        { mockFile: 'settings.html',       setup: 'navigateToSettings' }
};

async function isServerRunning() {
  try {
    const { execSync } = await import('node:child_process');
    execSync(`curl -sf ${SERVER_URL} > /dev/null 2>&1`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isServerRunning()) return null;
  const child = spawn(process.execPath, [join(HERE, 'server.js')], {
    stdio: 'ignore',
    cwd: ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: new URL(SERVER_URL).port }
  });
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    if (await isServerRunning()) return child;
  }
  child.kill();
  throw new Error('Server did not start within 10s');
}

function stopServer(child) {
  child?.kill();
}

async function setupProdPage(page, screenKey) {
  const setup = SCREENS[screenKey].setup;
  if (setup === 'skip') {
    await page.goto(SERVER_URL);
    return;
  }
  if (!setup) {
    await page.goto(SERVER_URL);
    return;
  }
  if (setup === 'clickStart' || setup === 'startRunToExploration' || setup === 'startRunToCombat') {
    await page.goto(`${SERVER_URL}?seed=777#w=777`);
    await page.getByTestId('add-character').waitFor({ timeout: 10000 });
    if (setup === 'clickStart') {
      await page.getByTestId('add-character').click();
      return;
    }
    await page.getByTestId('add-character').click();
    await page.getByTestId('class-breacher').click();
    await page.getByTestId('tab-sigil').click();
    await page.getByTestId('sigil-e000').click();
    await page.getByTestId('finalize').click();
    if (setup === 'startRunToExploration') return;
    await page.getByTestId('exploration-canvas').waitFor({ timeout: 5000 }).catch(() => {});
    return;
  }
  if (setup.startsWith('openConsoleTab:')) {
    const tab = setup.split(':')[1];
    await page.goto(`${SERVER_URL}?seed=777#w=777`);
    await page.getByTestId('add-character').waitFor({ timeout: 10000 });
    await page.getByTestId('add-character').click();
    await page.getByTestId('class-breacher').click();
    await page.getByTestId('tab-sigil').click();
    await page.getByTestId('sigil-e000').click();
    await page.getByTestId('finalize').click();
    await page.getByTestId('exploration-canvas').waitFor({ timeout: 5000 }).catch(() => {});
    await page.getByTestId(`console-tab-${tab}`).click().catch(() => {});
    return;
  }
  if (setup === 'navigateToLibrary') {
    await page.goto(SERVER_URL);
    await page.getByTestId('title-start').click();
    await page.getByTestId('title-run-library').click().catch(() => {});
    return;
  }
  if (setup === 'navigateToImport') {
    await page.goto(SERVER_URL);
    await page.getByTestId('title-start').click();
    await page.getByTestId('title-import-link').click().catch(() => {});
    return;
  }
  if (setup === 'navigateToTutorial') {
    await page.goto(SERVER_URL);
    await page.getByTestId('title-start').click();
    await page.getByTestId('title-tutorial').click().catch(() => {});
    return;
  }
  if (setup === 'navigateToSettings') {
    await page.goto(SERVER_URL);
    await page.getByTestId('title-start').click();
    await page.getByTestId('title-settings').click().catch(() => {});
    return;
  }
}

async function captureSideBySide(browser, screenKey, viewport, shotsDir) {
  const mockFile = SCREENS[screenKey].mockFile;
  const mockPath = join(MOCKS_DIR, mockFile);
  if (!existsSync(mockPath)) {
    console.error(`Mock file not found: ${mockPath}`);
    return { screen: screenKey, setupStatus: 'mock-missing' };
  }

  const mockPage = await browser.newPage({ viewport });
  await mockPage.goto(`file://${mockPath}`, { waitUntil: 'domcontentloaded' });
  await mockPage.waitForTimeout(1500);
  const mockFrame = mockPage.locator('.portrait-frame').first();
  await mockFrame.waitFor({ state: 'visible', timeout: 5000 });
  const mockSize = await mockFrame.boundingBox();
  const mockBuf = await mockFrame.screenshot({ type: 'png' });
  await mockPage.close();

  const prodPage = await browser.newPage({ viewport });
  await prodPage.addInitScript(() => {
    localStorage.setItem('od_settings', JSON.stringify({
      masterMute: true,
      layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
      glitchEnabled: false,
      reducedMotion: 'reduce',
      scanlineGrainEnabled: true
    }));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
  });

  try {
    await setupProdPage(prodPage, screenKey);
  } catch (error) {
    console.error(`Setup failed for ${screenKey}: ${error.message}`);
    await prodPage.close();
    return { screen: screenKey, setupStatus: `failed: ${error.message}` };
  }
  await prodPage.waitForTimeout(1000);
  const prodFrame = prodPage.locator('#portrait-frame').first();
  await prodFrame.waitFor({ state: 'visible', timeout: 5000 });
  const prodSize = await prodFrame.boundingBox();
  const prodBuf = await prodFrame.screenshot({ type: 'png' });
  await prodPage.close();

  console.log(`  ${screenKey}: mock=${mockBuf.length}B prod=${prodBuf.length}B`);

  const combinedWidth = Math.ceil(mockSize.width + prodSize.width);
  const combinedHeight = Math.ceil(Math.max(mockSize.height, prodSize.height));
  const combinedPage = await browser.newPage({ viewport: { width: combinedWidth, height: combinedHeight } });
  await combinedPage.setContent(
    `<html><body style="margin:0;padding:0;display:flex;background:#000">
       <img src="data:image/png;base64,${prodBuf.toString('base64')}"/>
       <img src="data:image/png;base64,${mockBuf.toString('base64')}"/>
     </body></html>`,
    { waitUntil: 'domcontentloaded' }
  );
  await combinedPage.waitForTimeout(200);
  const sideBySideBuf = await combinedPage.screenshot({ type: 'png' });
  await combinedPage.close();

  const baseName = `${screenKey}.png`;
  const sideBySidePath = resolve(join(shotsDir, baseName));
  const prodOutputPath = resolve(join(shotsDir, `${screenKey}-prod.png`));
  const mockOutputPath = resolve(join(shotsDir, `${screenKey}-mock.png`));
  writeFileSync(sideBySidePath, sideBySideBuf);
  writeFileSync(prodOutputPath, prodBuf);
  writeFileSync(mockOutputPath, mockBuf);

  return {
    screen: screenKey,
    mockPath: mockOutputPath,
    prodPath: prodOutputPath,
    sideBySidePath,
    mockSize: { width: Math.round(mockSize.width), height: Math.round(mockSize.height) },
    prodSize: { width: Math.round(prodSize.width), height: Math.round(prodSize.height) },
    setupStatus: 'ready'
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { screen: null, all: false, list: false, viewport: DEFAULT_VIEWPORT, outDir: DEFAULT_SHOTS_DIR };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--screen') {
      result.screen = args[++i];
    } else if (args[i] === '--all') {
      result.all = true;
    } else if (args[i] === '--list') {
      result.list = true;
    } else if (args[i] === '--viewport') {
      const value = args[++i];
      const match = /^(\d+)x(\d+)$/.exec(value || '');
      if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) {
        console.error(`Invalid viewport: ${value}`);
        process.exit(2);
      }
      result.viewport = { width: Number(match[1]), height: Number(match[2]) };
    } else if (args[i] === '--out-dir') {
      const value = args[++i];
      if (!value) {
        console.error('--out-dir requires a path');
        process.exit(2);
      }
      result.outDir = resolve(ROOT, value);
    } else {
      console.error(`Unknown flag: ${args[i]}`);
      console.error('Usage: node ./scripts/screenshot-parity.js [--screen <name> | --all | --list] [--viewport WIDTHxHEIGHT] [--out-dir <path>]');
      process.exit(2);
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.list) {
    console.log(Object.keys(SCREENS).join('\n'));
    return;
  }

  mkdirSync(args.outDir, { recursive: true });

  let targets;
  if (args.all) {
    targets = Object.keys(SCREENS);
  } else if (args.screen) {
    if (!SCREENS[args.screen]) {
      console.error(`Unknown screen: ${args.screen}`);
      console.error('Available: ' + Object.keys(SCREENS).join(', '));
      process.exit(2);
    }
    targets = [args.screen];
  } else {
    console.error('Usage: node ./scripts/screenshot-parity.js [--screen <name> | --all | --list] [--viewport WIDTHxHEIGHT] [--out-dir <path>]');
    process.exit(2);
  }

  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true });

  try {
    const report = [];
    for (const screenKey of targets) {
      const entry = await captureSideBySide(browser, screenKey, args.viewport, args.outDir);
      report.push(entry);
      if (entry.sideBySidePath) {
        console.log(entry.sideBySidePath);
      } else {
        console.log(`SKIP: ${screenKey}`);
      }
    }
    writeFileSync(join(args.outDir, 'report.json'), `${JSON.stringify(report)}\n`);
  } finally {
    await browser.close();
    stopServer(server);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
