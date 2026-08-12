import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MOCKS_DIR = join(ROOT, 'mocks');
const SHOTS_DIR = join(ROOT, 'program', 'operator-s-descent', 'prompts', 'visual-parity-v2', 'shots');
const SERVER_URL = 'http://127.0.0.1:8080/';

const VIEWPORT = { width: 1080, height: 1920 };

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
  if (await isServerRunning()) return false;
  const child = spawn(process.execPath, [join(HERE, 'start.js')], {
    detached: true,
    stdio: 'ignore',
    cwd: ROOT
  });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    if (await isServerRunning()) return true;
  }
  throw new Error('Server did not start within 10s');
}

async function stopServer() {
  try {
    spawn(process.execPath, [join(HERE, 'stop.js')], { stdio: 'ignore', cwd: ROOT });
  } catch {}
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

async function captureSideBySide(browser, screenKey) {
  const mockFile = SCREENS[screenKey].mockFile;
  const mockPath = join(MOCKS_DIR, mockFile);
  if (!existsSync(mockPath)) {
    console.error(`Mock file not found: ${mockPath}`);
    return null;
  }

  const mockPage = await browser.newPage({ viewport: VIEWPORT });
  await mockPage.goto(`file://${mockPath}`, { waitUntil: 'domcontentloaded' });
  await mockPage.waitForTimeout(1500);
  const mockBuf = await mockPage.screenshot({ type: 'png' });
  await mockPage.close();

  const prodPage = await browser.newPage({ viewport: VIEWPORT });
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
    return null;
  }
  await prodPage.waitForTimeout(1000);
  const prodBuf = await prodPage.screenshot({ type: 'png' });
  await prodPage.close();

  const combinedPage = await browser.newPage({ viewport: { width: 2160, height: 1920 } });
  await combinedPage.setContent(
    `<html><body style="margin:0;padding:0;display:flex;background:#000">
       <img src="data:image/png;base64,${prodBuf.toString('base64')}" style="width:1080px;height:1920px"/>
       <img src="data:image/png;base64,${mockBuf.toString('base64')}" style="width:1080px;height:1920px"/>
     </body></html>`,
    { waitUntil: 'domcontentloaded' }
  );
  await combinedPage.waitForTimeout(200);
  const sideBySideBuf = await combinedPage.screenshot({ type: 'png' });
  await combinedPage.close();

  const baseName = `${screenKey}.png`;
  writeFileSync(join(SHOTS_DIR, baseName), sideBySideBuf);
  writeFileSync(join(SHOTS_DIR, `${screenKey}-prod.png`), prodBuf);
  writeFileSync(join(SHOTS_DIR, `${screenKey}-mock.png`), mockBuf);

  return resolve(join(SHOTS_DIR, baseName));
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { screen: null, all: false, list: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--screen') {
      result.screen = args[++i];
    } else if (args[i] === '--all') {
      result.all = true;
    } else if (args[i] === '--list') {
      result.list = true;
    } else {
      console.error(`Unknown flag: ${args[i]}`);
      console.error('Usage: node ./scripts/screenshot-parity.js [--screen <name> | --all | --list]');
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

  mkdirSync(SHOTS_DIR, { recursive: true });

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
    console.error('Usage: node ./scripts/screenshot-parity.js [--screen <name> | --all | --list]');
    process.exit(2);
  }

  const weStartedServer = await ensureServer();
  const browser = await chromium.launch({ headless: true });

  try {
    for (const screenKey of targets) {
      const path = await captureSideBySide(browser, screenKey);
      if (path) {
        console.log(path);
      } else {
        console.log(`SKIP: ${screenKey}`);
      }
    }
  } finally {
    await browser.close();
    if (weStartedServer) {
      await stopServer();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});