import { fileURLToPath } from "node:url";

/**
 * `katex-font-display` is referenced by absolute path: Turbopack evaluates this
 * config from its own working directory, so a relative specifier does not
 * resolve. See the plugin's header for why KaTeX's `font-display: block` has to
 * be rewritten here rather than overridden in a stylesheet.
 */
const katexFontDisplay = fileURLToPath(
  new URL("./postcss/katex-font-display.cjs", import.meta.url),
);

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    [katexFontDisplay]: {},
  },
};

export default config;
