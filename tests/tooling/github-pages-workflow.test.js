import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = new URL('../../.github/workflows/deploy-pages.yml', import.meta.url);
const SOURCE = readFileSync(WORKFLOW_PATH, 'utf8');

// No YAML parser is a project devDependency (Custom Rule 2), so this suite
// pins the workflow's required behaviors as plain-text contracts instead of
// parsing structured YAML.

function section(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  expect(start, `expected to find "${startMarker}" in the workflow`).toBeGreaterThan(-1);
  const end = endMarker ? SOURCE.indexOf(endMarker, start + startMarker.length) : SOURCE.length;
  expect(end === -1 ? SOURCE.length : end, `expected to find "${endMarker}" after "${startMarker}"`).toBeGreaterThan(start);
  return SOURCE.slice(start, end === -1 ? SOURCE.length : end);
}

const buildJob = section('\n  build:\n', '\n  deploy:\n');
const deployJob = section('\n  deploy:\n');

describe('deploy-pages workflow — triggers', () => {
  it('deploys only on push to main and manual dispatch', () => {
    const triggers = section('\non:\n', '\npermissions:\n');
    expect(triggers).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(triggers).toMatch(/workflow_dispatch:/);
    expect(triggers).not.toMatch(/pull_request/);
    expect(triggers).not.toMatch(/schedule:/);
  });
});

describe('deploy-pages workflow — least-privilege permissions', () => {
  it('grants only contents:read, pages:write, id-token:write', () => {
    const permissions = section('\npermissions:\n', '\nconcurrency:\n');
    expect(permissions).toMatch(/contents:\s*read/);
    expect(permissions).toMatch(/pages:\s*write/);
    expect(permissions).toMatch(/id-token:\s*write/);
    expect(SOURCE).not.toMatch(/contents:\s*write/);
  });
});

describe('deploy-pages workflow — build job', () => {
  it('checks out with actions/checkout@v7 and sets up Node 22 with npm caching', () => {
    expect(buildJob).toMatch(/uses:\s*actions\/checkout@v7/);
    expect(buildJob).toMatch(/uses:\s*actions\/setup-node@v7/);
    expect(buildJob).toMatch(/node-version:\s*'22'/);
    expect(buildJob).toMatch(/cache:\s*'npm'/);
    expect(buildJob).toMatch(/run:\s*npm ci/);
  });

  it('configures Pages, regenerates committed assets, and rejects generated-file drift', () => {
    expect(buildJob).toMatch(/uses:\s*actions\/configure-pages@v5/);
    expect(buildJob).toMatch(/run:\s*npm run build:assets/);
    expect(buildJob).toMatch(/run:\s*git diff --exit-code -- \.\/styles\/tailwind\.css \.\/assets\/icons\.svg/);
  });

  it('verifies the production manifest and runs exactly the Pages-specific contract suite', () => {
    expect(buildJob).toMatch(/run:\s*npm run check:assets/);
    expect(buildJob).toMatch(
      /run:\s*npx vitest run \.\/tests\/integration\/service-worker\.test\.js \.\/tests\/tools\/build-pages\.test\.js \.\/tests\/tooling\/github-pages-workflow\.test\.js/
    );
    expect(buildJob).not.toMatch(/npm test\b/);
    expect(buildJob).not.toMatch(/npm run validate/);
    expect(buildJob).not.toMatch(/npm run check:release/);
  });

  it('stages the artifact under runner-temp, never the repository root', () => {
    expect(buildJob).toMatch(/run:\s*npm run build:pages -- --output "\$\{RUNNER_TEMP\}\/operator-s-descent-pages"/);
    expect(buildJob).not.toMatch(/build:pages\s+--output\s+\.\//);
    expect(buildJob).not.toMatch(/build:pages\s+--output\s+"?\$\{?\{?\s*github\.workspace/i);
  });

  it('uploads only the matching runner-temp staging directory', () => {
    expect(buildJob).toMatch(/uses:\s*actions\/upload-pages-artifact@v4/);
    expect(buildJob).toMatch(/path:\s*\$\{\{\s*runner\.temp\s*\}\}\/operator-s-descent-pages/);
  });
});

describe('deploy-pages workflow — deploy job', () => {
  it('depends on build and never checks out source', () => {
    expect(deployJob).toMatch(/needs:\s*build/);
    expect(deployJob).not.toMatch(/actions\/checkout/);
  });

  it('uses the github-pages environment with the deployment URL output', () => {
    expect(deployJob).toMatch(/environment:\s*\n\s*name:\s*github-pages/);
    expect(deployJob).toMatch(/url:\s*\$\{\{\s*steps\.deployment\.outputs\.page_url\s*\}\}/);
  });

  it('deploys with actions/deploy-pages@v4', () => {
    expect(deployJob).toMatch(/uses:\s*actions\/deploy-pages@v4/);
  });
});

describe('deploy-pages workflow — concurrency', () => {
  it('serializes Pages deployments without cancelling an in-flight run', () => {
    const concurrency = section('\nconcurrency:\n', '\njobs:\n');
    expect(concurrency).toMatch(/group:\s*github-pages/);
    expect(concurrency).toMatch(/cancel-in-progress:\s*false/);
  });
});
