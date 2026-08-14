/**
 * Ship KaTeX's math with `font-display: swap`.
 *
 * `katex/dist/katex.min.css` declares all twenty of its faces with
 * `font-display: block`: the browser lays the glyphs out and paints nothing
 * for up to three seconds while the font downloads. On /learn that is the
 * whole page — 192 KaTeX instances of derivation, arriving as blank space.
 * Math is text; it should render in a fallback face and swap, like everything
 * else on the site does (Geist is already `swap`).
 *
 * **Why a build-time rewrite and not a stylesheet override.** CSS has no way to
 * change one descriptor of an existing `@font-face`, and re-declaring the face
 * does not replace it: measured in Chrome 1a4, a family with a `block` face and
 * a `swap` face renders as `block` whichever order they appear in — both faces
 * stay in the family and the blocking one governs. (Isolated test: `only-swap`
 * paints its fallback at 800 ms with the font still pending; `block-then-swap`
 * and `swap-then-block` both paint nothing.) So the `block` declaration has to
 * not reach the browser at all, which means editing it on the way through.
 *
 * Scope is deliberately narrow: only `@font-face` rules whose family starts
 * with `KaTeX_`, and only the `font-display` descriptor. Every other byte of
 * katex.min.css — and every other stylesheet in the app — passes through
 * untouched, so this is a patch, not a fork: upgrade katex and it keeps
 * applying.
 */

const plugin = () => ({
  postcssPlugin: "katex-font-display",
  AtRule: {
    "font-face": (rule) => {
      let isKatex = false;
      rule.walkDecls("font-family", (decl) => {
        if (decl.value.replace(/["']/g, "").startsWith("KaTeX_")) isKatex = true;
      });
      if (!isKatex) return;

      let declared = false;
      rule.walkDecls("font-display", (decl) => {
        declared = true;
        if (decl.value.trim() === "block") decl.value = "swap";
      });
      // A future katex could drop the descriptor; the default is `auto`, which
      // most engines treat as `block` for a font this small.
      if (!declared) rule.append({ prop: "font-display", value: "swap" });
    },
  },
});

plugin.postcss = true;

module.exports = plugin;
