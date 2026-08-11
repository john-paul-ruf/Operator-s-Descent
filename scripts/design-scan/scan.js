import { checkColorTokens, checkCornerRadius } from './check-tokens.js';
import { checkTouchTargets } from './check-touch-targets.js';
import { checkGlitchTimings } from './check-effects.js';
import { checkScreenInventory, checkConsoleModeInventory } from './check-screen-inventory.js';
import { checkMockClasses } from './check-mock-classes.js';
import { checkMockTokens } from './check-mock-tokens.js';

export async function runDesignComplianceScan() {
  return {
    'Color tokens (specs/design.md vs styles/base.css)': checkColorTokens(),
    'Corner radius (specs/design.md vs styles/base.css)': checkCornerRadius(),
    'Touch targets (specs/design.md vs styles/components.css)': checkTouchTargets(),
    'Glitch/CRT timing constants (FR-23 vs src/glitch/glitch.js)': await checkGlitchTimings(),
    'Screen inventory (mocks vs src/ui/screens)': checkScreenInventory(),
    'Console mode inventory (mocks vs src/ui/console)': checkConsoleModeInventory(),
    'Mock color tokens (mocks vs specs/design.md)': checkMockTokens(),
    'Mock component classes (mocks vs styles/*.css)': checkMockClasses()
  };
}