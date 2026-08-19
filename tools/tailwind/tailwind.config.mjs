/**
 * Tailwind config for Operator's Descent — dev-time compilation only.
 * Preflight is disabled so styles/base.css palette tokens win.
 */
export default {
  content: ['./index.html', './src/**/*.js', './styles/*.css'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        accent: 'var(--accent)',
        danger: 'var(--danger)',
        heal: 'var(--heal)',
        panel: 'var(--bg-panel)',
        panelHi: 'var(--bg-panel-elevated)',
        base: 'var(--bg-base)',
        text: 'var(--text-primary)',
        textDim: 'var(--text-dim)',
        textSecondary: 'var(--text-secondary)',
        border: 'var(--border-dim)'
      },
      fontFamily: {
        mono: ['ui-monospace', 'SF Mono', 'Roboto Mono', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
};
