#!/usr/bin/env node
/**
 * Route smoke test — boot the built app and assert every route actually
 * *serves*.
 *
 * This exists because `next build` succeeding proves nothing about request
 * time. The calc sheet shipped 500ing for a whole release: the component tree
 * compiled, typechecked and built clean, then threw
 * "useVisibility must be used within a VisibilityProvider" on every render.
 * Nothing in lint/typecheck/test/build can see that — only asking the running
 * server for the page can.
 *
 * The other half of the lesson is in `assertOk`: the original hand check
 * grepped the response body for a string and called it a pass, but Next streams
 * the RSC payload into the error page, so the spec's own title survived into
 * the 500 and the grep matched. Status first, content second — and the status
 * is what fails the build.
 *
 * Run: `pnpm build && pnpm smoke` (CI does exactly this).
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.SMOKE_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;
const BOOT_TIMEOUT_MS = 60_000;

/** A design payload with real demands — exercises the full check set, not the empty path. */
const WALL =
  "eyJ2IjoyLCJnIjpbMzM2LDEyLDExMDQsMjAyLDAuOCwxLjVdLCJtIjpbNTAwMCwxLDYwXSwidnIiOlsiNSIsMTIsMl0sImh6IjpbIjUiLDEyLDJdLCJleiI6bnVsbCwiZCI6W1sibG9hZC0xIiwiYmFzZSIsMTAxNSwxODYwMCwyMzUsbnVsbCxudWxsXV0sInd0IjoiYiIsInN5IjoibyIsInNtIjpudWxsLCJzYiI6bnVsbCwicHIiOm51bGx9";

/**
 * The same wall with vertical bars at 200 in on a 336 in wall: a payload the
 * codec accepts and the engine cannot evaluate (no bar stations). The document
 * route must degrade to an explanation rather than 500, and the PDF route must
 * refuse rather than emit a file — the workspace hides its PDF link in this
 * state, but a shared link can still reach the route directly.
 */
const UNEVALUABLE =
  "eyJ2IjoyLCJnIjpbMzM2LDEyLDExMDQsMjAyLDAuOCwxLjVdLCJtIjpbNTAwMCwxLDYwXSwidnIiOlsiNSIsMjAwLDJdLCJoeiI6WyI1IiwxMiwyXSwiZXoiOm51bGwsImQiOltbImxvYWQtMSIsImJhc2UiLDEwMTUsMTg2MDAsMjM1LG51bGwsbnVsbF1dLCJ3dCI6ImIiLCJzeSI6Im8iLCJzbSI6bnVsbCwic2IiOm51bGwsInByIjpudWxsfQ";

const ROUTES = [
  { path: "/", label: "landing" },
  { path: "/learn", label: "learn index" },
  { path: "/design", label: "design workspace", expect: "shear wall design" },
  { path: "/design/report", label: "calc sheet (default wall)", expect: "design inputs" },
  {
    path: `/design/report?w=${WALL}`,
    label: "calc sheet (shared link)",
    expect: "design inputs",
  },
  { path: "/api/report/pdf", label: "pdf export", pdf: true },
  { path: `/api/report/pdf?w=${WALL}`, label: "pdf export (shared link)", pdf: true },
  {
    path: `/design/report?w=${UNEVALUABLE}`,
    label: "calc sheet (unevaluable wall degrades)",
    expect: "the engine could not run",
  },
  {
    path: `/api/report/pdf?w=${UNEVALUABLE}`,
    label: "pdf export refuses an unevaluable wall",
    status: 422,
  },
];

const failures = [];

async function assertOk(route) {
  let response;
  try {
    response = await fetch(BASE + route.path);
  } catch (err) {
    failures.push(`${route.label} — request failed: ${String(err)}`);
    return;
  }

  // Status is the assertion that matters: a 500 still returns a body, and that
  // body can contain the very strings a content check looks for.
  const wanted = route.status ?? 200;
  if (response.status !== wanted) {
    failures.push(`${route.label} — HTTP ${response.status}, expected ${wanted} (${route.path})`);
    return;
  }
  // A deliberate refusal must not masquerade as a document: the workspace hides
  // the link, but `download` would save whatever a direct hit returns.
  if (wanted !== 200) {
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("application/pdf")) {
      failures.push(`${route.label} — refused with ${wanted} but sent a PDF content-type`);
    } else {
      console.log(`  ok  ${route.label} — ${wanted}, ${type.split(";")[0]}`);
    }
    return;
  }

  if (route.pdf === true) {
    const type = response.headers.get("content-type") ?? "";
    const bytes = new Uint8Array(await response.arrayBuffer());
    const magic = new TextDecoder().decode(bytes.slice(0, 5));
    if (!type.includes("application/pdf")) {
      failures.push(`${route.label} — content-type "${type}", expected application/pdf`);
    } else if (magic !== "%PDF-") {
      failures.push(`${route.label} — body is not a PDF (starts "${magic}")`);
    } else if (bytes.length < 1000) {
      failures.push(`${route.label} — PDF is only ${bytes.length} bytes`);
    } else {
      console.log(`  ok  ${route.label} — ${bytes.length} bytes of PDF`);
    }
    return;
  }

  const body = await response.text();
  if (route.expect !== undefined && !body.includes(route.expect)) {
    failures.push(`${route.label} — 200 but body is missing "${route.expect}"`);
    return;
  }
  console.log(`  ok  ${route.label}`);
}

async function waitForServer(child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode})`);
    try {
      const probe = await fetch(BASE + "/design");
      if (probe.status > 0) return;
    } catch {
      // not listening yet
    }
    await sleep(400);
  }
  throw new Error(`server did not start within ${BOOT_TIMEOUT_MS} ms`);
}

const server = spawn("node_modules/.bin/next", ["start", "-p", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});

// A route can answer 200 and still have logged a recovered render error; keep
// the output so a failure is debuggable from the CI log alone.
const serverLog = [];
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => serverLog.push(chunk));
}

let exitCode = 0;
try {
  await waitForServer(server);
  console.log(`smoke: ${ROUTES.length} routes against ${BASE}\n`);
  for (const route of ROUTES) await assertOk(route);

  // A route can answer 200 and still have logged a recovered render error, so
  // the log is checked independently of the status assertions above.
  const logged = serverLog.join("");
  if (logged.includes("⨯")) failures.push("server logged a render error (see output below)");

  if (failures.length > 0) {
    console.error(`\nsmoke failed — ${failures.length} problem(s):`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error("\n--- server output ---\n" + logged.trim());
    exitCode = 1;
  } else {
    console.log(`\nsmoke passed — ${ROUTES.length}/${ROUTES.length} routes served`);
  }
} catch (err) {
  console.error(`smoke failed: ${String(err)}`);
  console.error("\n--- server output ---\n" + serverLog.join("").trim());
  exitCode = 1;
} finally {
  server.kill("SIGTERM");
}

process.exit(exitCode);
