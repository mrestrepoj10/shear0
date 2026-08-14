"use client";

/**
 * Keeping the address bar and the reducer in step.
 *
 * The payload format lives in `wall-codec.ts` (a plain module, so the server can
 * decode `?w=` for the first render); this file is the client half — read once
 * on mount for anything the server did not already apply, then a debounced
 * `history.replaceState` (~300 ms) on every edit. Only the *URL write* is
 * debounced: the engine still runs synchronously on every keystroke.
 */

import type { WallInput } from "@kern/engine";
import { useEffect, useRef } from "react";
import { WALL_PARAM, decodeWallInput, encodeWallInput } from "./wall-codec";
import type { WallAction } from "./wall-state";

export {
  PAYLOAD_VERSION,
  WALL_PARAM,
  decodeWallInput,
  encodeWallInput,
} from "./wall-codec";

/** Reads `?w=` from the current location. Client-only; null when absent or bad. */
export function readWallFromLocation(): WallInput | null {
  if (typeof window === "undefined") return null;
  const encoded = new URLSearchParams(window.location.search).get(WALL_PARAM);
  if (encoded === null || encoded.length === 0) return null;
  return decodeWallInput(encoded);
}

const URL_WRITE_DEBOUNCE_MS = 300;

/**
 * Loads `?w=` once on mount, then keeps the URL in step with the state via a
 * debounced `history.replaceState` (no navigation, no history spam).
 *
 * The load is a no-op when the page was server-rendered from the same link,
 * which is the normal case — it still runs for a client-side navigation into
 * /design, and it is the one place a hand-edited `?w=` gets picked up.
 *
 * `skipFirstWrite` suppresses that debounced write until the wall actually
 * changes — passed when the mount-time `?w=` failed to decode, so the broken
 * link survives on screen instead of being overwritten 300 ms later.
 */
export function useWallUrlSync(
  input: WallInput,
  dispatch: (action: WallAction) => void,
  options: { skipFirstWrite?: boolean } = {},
): void {
  const loaded = useRef(false);
  // Set only when the page mounted with a `?w=` that would not decode: the
  // wall as it stood at mount, held so the sync can tell "nothing has happened
  // yet" from "the user edited something". Cleared on the first real edit.
  const untouched = useRef<WallInput | null>(options.skipFirstWrite === true ? input : null);

  // Runs on every input, does its work once: the guard means `input` here is
  // always the mount-time state, i.e. whatever the server put in the provider.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const fromUrl = readWallFromLocation();
    if (fromUrl === null) return;
    if (encodeWallInput(fromUrl) === encodeWallInput(input)) return;
    dispatch({ type: "loadPreset", input: fromUrl });
  }, [dispatch, input]);

  useEffect(() => {
    if (!loaded.current) return;
    // A payload that could not be read is evidence: leave it in the address bar
    // (it is the only copy of whatever the sender meant to share) until the
    // user edits the wall, at which point the URL is theirs again.
    if (untouched.current !== null) {
      if (untouched.current === input) return;
      untouched.current = null;
    }
    const timer = window.setTimeout(() => {
      const encoded = encodeWallInput(input);
      const params = new URLSearchParams(window.location.search);
      if (params.get(WALL_PARAM) === encoded) return;
      params.set(WALL_PARAM, encoded);
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}?${params.toString()}`,
      );
    }, URL_WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input]);
}
