import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..');

// scripts/server.js and tools/serve.mjs both bind an http server as a
// top-level side effect (no `if (process.argv[1] === ...)` CLI guard), so
// they are read as text rather than imported.
function mimeMapSource(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

const manifestSource = readFileSync(resolve(ROOT, 'manifest.webmanifest'), 'utf8');
const manifest = JSON.parse(manifestSource);
const indexHtml = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

function pngDimensions(path) {
  const buffer = readFileSync(path);
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('manifest.webmanifest', () => {
  test('is valid JSON with an installable standalone identity', () => {
    expect(manifest.name).toBe("Operator's Descent");
    expect(manifest.short_name).toBe('Descent');
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.id).toBe('./');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.background_color).toBe('#0a0612');
    expect(manifest.theme_color).toBe('#0a0612');
  });

  test('declares any-maskable 192 and 512 PNG launcher icons', () => {
    expect(Array.isArray(manifest.icons)).toBe(true);
    const bySize = Object.fromEntries(manifest.icons.map((icon) => [icon.sizes, icon]));
    for (const size of ['192x192', '512x512']) {
      expect(bySize[size]).toBeTruthy();
      expect(bySize[size].type).toBe('image/png');
      expect(bySize[size].purpose).toBe('any maskable');
      expect(bySize[size].src.startsWith('./assets/app-icon-')).toBe(true);
    }
  });
});

describe('index.html PWA metadata', () => {
  test('links the manifest, favicon, and apple touch icon with bare relative hrefs', () => {
    expect(indexHtml).toMatch(/<link rel="manifest" href="manifest\.webmanifest">/);
    expect(indexHtml).toMatch(/<link rel="icon" href="assets\/app-icon\.svg" type="image\/svg\+xml">/);
    expect(indexHtml).toMatch(/<link rel="apple-touch-icon" href="assets\/app-icon-180\.png">/);
  });

  test('declares theme-color and apple-mobile-web-app metadata', () => {
    expect(indexHtml).toMatch(/<meta name="theme-color" content="#0a0612">/);
    expect(indexHtml).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes">/);
    expect(indexHtml).toMatch(/<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/);
    expect(indexHtml).toMatch(/<meta name="apple-mobile-web-app-title" content="Operator's Descent">/);
  });

  test('the viewport is browser-zoomable and safe-area aware', () => {
    const match = indexHtml.match(/<meta name="viewport" content="([^"]+)">/);
    expect(match).toBeTruthy();
    const content = match[1];
    expect(content).toContain('width=device-width');
    expect(content).toContain('initial-scale=1');
    expect(content).toContain('viewport-fit=cover');
    expect(content).not.toMatch(/maximum-scale/);
    expect(content).not.toMatch(/user-scalable/);
  });
});

describe('launcher icon assets', () => {
  test('app-icon.svg is an original, self-contained geometric mark', () => {
    const svg = readFileSync(resolve(ROOT, 'assets', 'app-icon.svg'), 'utf8');
    expect(svg).toMatch(/viewBox="0 0 512 512"/);
    expect(svg).not.toMatch(/xlink:href|<image/);
  });

  test('committed PNG variants match their declared dimensions', () => {
    expect(pngDimensions(resolve(ROOT, 'assets', 'app-icon-180.png'))).toEqual({ width: 180, height: 180 });
    expect(pngDimensions(resolve(ROOT, 'assets', 'app-icon-192.png'))).toEqual({ width: 192, height: 192 });
    expect(pngDimensions(resolve(ROOT, 'assets', 'app-icon-512.png'))).toEqual({ width: 512, height: 512 });
  });
});

describe('local dev server MIME support', () => {
  test('scripts/server.js and tools/serve.mjs serve .webmanifest as application/manifest+json', () => {
    const mimeEntry = /'\.webmanifest':\s*'application\/manifest\+json'/;
    expect(mimeMapSource('scripts/server.js')).toMatch(mimeEntry);
    expect(mimeMapSource('tools/serve.mjs')).toMatch(mimeEntry);
  });
});

describe('safe-area CSS contract', () => {
  const baseCss = readFileSync(resolve(ROOT, 'styles', 'base.css'), 'utf8');
  const componentsCss = readFileSync(resolve(ROOT, 'styles', 'components.css'), 'utf8');
  const wideCss = readFileSync(resolve(ROOT, 'styles', 'wide.css'), 'utf8');

  test('base.css declares the four safe-area inset custom properties', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(baseCss).toMatch(new RegExp(`--safe-area-${side}:\\s*env\\(safe-area-inset-${side},\\s*0px\\)`));
    }
  });

  test('#app-root pads its content box with the safe-area variables', () => {
    const rule = baseCss.match(/#app-root\s*{([^}]*)}/);
    expect(rule).toBeTruthy();
    expect(rule[1]).toMatch(/padding:\s*var\(--safe-area-top\)\s+var\(--safe-area-right\)\s+var\(--safe-area-bottom\)\s+var\(--safe-area-left\)/);
  });

  test('#crt-overlays stays edge-to-edge — no safe-area inset applied', () => {
    const rule = baseCss.match(/#crt-overlays\s*{([^}]*)}/);
    expect(rule).toBeTruthy();
    expect(rule[1]).not.toMatch(/safe-area/);
    expect(rule[1]).toMatch(/inset:\s*0/);
  });

  test('.in-run-screen fills the padded frame (100%), never a raw 100vh/100dvh viewport unit', () => {
    const rule = componentsCss.match(/\.in-run-screen\s*{([^}]*)}/);
    expect(rule).toBeTruthy();
    expect(rule[1]).toMatch(/height:\s*100%/);
    expect(rule[1]).not.toMatch(/height:\s*100d?vh/);
    expect([...componentsCss.matchAll(/\.in-run-screen\s*{[^}]*}/g)]).toHaveLength(1);
  });

  test('.update-toast clears the safe-area bottom inset and stays within the safe-area lateral bounds', () => {
    const rule = componentsCss.match(/\.update-toast\s*{([^}]*)}/);
    expect(rule).toBeTruthy();
    expect(rule[1]).toMatch(/bottom:\s*calc\(24px \+ var\(--safe-area-bottom\)\)/);
    expect(rule[1]).toMatch(/max-width:\s*calc\(100vw - var\(--safe-area-left\) - var\(--safe-area-right\)/);
  });

  test('wide .wide-shell fills the padded frame (100%), never a raw 100vw/100vh viewport unit', () => {
    const rule = wideCss.match(/\.wide-shell\s*{([^}]*)}/);
    expect(rule).toBeTruthy();
    expect(rule[1]).toMatch(/width:\s*100%/);
    expect(rule[1]).toMatch(/height:\s*100%/);
    expect(rule[1]).toMatch(/grid-template-rows:\s*100%/);
  });
});
