/**
 * Interface copy that has to read the same wherever it appears.
 *
 * The disclaimer is the one sentence in kern with legal weight, and it was
 * written three different ways — a footer line, a markdown epilogue and a learn
 * paragraph — so a reader comparing an exported report against the page found
 * three different promises. One string, three renderings that differ only in
 * capitalisation and full stop.
 */

/** Chrome voice: lowercase, no terminal punctuation, like the rest of the UI. */
export const DISCLAIMER = "requires review by a licensed engineer — not engineering advice";

/** Prose voice, for surfaces that are sentences (the markdown export, /learn). */
export const DISCLAIMER_SENTENCE = `${DISCLAIMER.charAt(0).toUpperCase()}${DISCLAIMER.slice(1)}.`;
