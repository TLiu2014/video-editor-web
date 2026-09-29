/**
 * Tailwind v4 wires through a single PostCSS plugin. Matches the
 * Tailwind toolchain in apps/web (which uses @tailwindcss/vite —
 * here we use the framework-agnostic @tailwindcss/postcss variant).
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
