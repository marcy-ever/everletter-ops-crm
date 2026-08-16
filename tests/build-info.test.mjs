import assert from "node:assert/strict";
import test from "node:test";

// lib/build-info.ts reads process.env directly at call time - real
// end-to-end proof that NEXT_PUBLIC_BUILD_TIME/NEXT_PUBLIC_BUILD_SHA
// actually get inlined by Next's build step (not just read at runtime) is
// a separate, Docker-based verification (this task's own PR description),
// not something a unit test can prove - this file only locks the pure
// logic: what getBuildInfo() returns for a given process.env shape.
import { getBuildInfo } from "../lib/build-info.ts";

const ENV_KEYS = ["NEXT_PUBLIC_BUILD_TIME", "NEXT_PUBLIC_BUILD_SHA", "NODE_ENV"];
let savedEnv;

test.beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

test.afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test("both build vars set: returns the formatted label and both raw values", () => {
  process.env.NEXT_PUBLIC_BUILD_TIME = "2026-08-16 18:32 UTC";
  process.env.NEXT_PUBLIC_BUILD_SHA = "a1b2c3d";
  assert.deepEqual(getBuildInfo(), {
    label: "2026-08-16 18:32 UTC · a1b2c3d",
    buildTime: "2026-08-16 18:32 UTC",
    commitSha: "a1b2c3d",
  });
});

test("NODE_ENV=development with no build vars: the dev-server fallback, never fabricated", () => {
  process.env.NODE_ENV = "development";
  assert.deepEqual(getBuildInfo(), { label: "dev", buildTime: null, commitSha: null });
});

test("NODE_ENV=production (or unset) with no build vars: the unstamped-container fallback", () => {
  process.env.NODE_ENV = "production";
  assert.deepEqual(getBuildInfo(), { label: "local build", buildTime: null, commitSha: null });

  delete process.env.NODE_ENV;
  assert.deepEqual(getBuildInfo(), { label: "local build", buildTime: null, commitSha: null });
});

test("only one of the two build vars set: treated as unstamped, not a half-true label", () => {
  process.env.NEXT_PUBLIC_BUILD_TIME = "2026-08-16 18:32 UTC";
  // NEXT_PUBLIC_BUILD_SHA deliberately left unset.
  assert.deepEqual(getBuildInfo(), { label: "local build", buildTime: null, commitSha: null });

  delete process.env.NEXT_PUBLIC_BUILD_TIME;
  process.env.NEXT_PUBLIC_BUILD_SHA = "a1b2c3d";
  assert.deepEqual(getBuildInfo(), { label: "local build", buildTime: null, commitSha: null });
});

test("empty-string build vars (an unset Docker ARG's default) are treated the same as absent", () => {
  process.env.NEXT_PUBLIC_BUILD_TIME = "";
  process.env.NEXT_PUBLIC_BUILD_SHA = "";
  assert.deepEqual(getBuildInfo(), { label: "local build", buildTime: null, commitSha: null });
});
