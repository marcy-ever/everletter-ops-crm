// Node's native TS loader (--experimental-strip-types) requires explicit
// file extensions on relative specifiers and doesn't understand the "@/"
// path alias, but this repo's application code uses extensionless
// specifiers and "@/" imports throughout (tsconfig.json's paths: {"@/*":
// ["./*"]}, moduleResolution: "bundler" - explicit .ts extensions are a
// type error there without allowImportingTsExtensions, which isn't and
// shouldn't be enabled just to satisfy a test runner). This loader hook
// bridges the two so tests can import real application .ts files (e.g.
// lib/dual-write.ts, lib/build-dataset-from-tables.ts) directly instead of
// needing a throwaway scratch copy with rewritten imports:
//  - "@/x" is remapped to the repo root, same as tsconfig.json's paths.
//  - a relative or remapped specifier with no extension that doesn't
//    resolve as-is is retried with ".ts" appended, then "/index.ts"
//    (for directory-style imports like "../db" -> "../db/index.ts").
// Test-only infrastructure - never touches application source or tsconfig.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const REPO_ROOT = pathToFileURL(path.resolve(import.meta.dirname, "..") + "/");

export async function resolve(specifier, context, nextResolve) {
  let candidateSpecifier = specifier;
  let base = context.parentURL;

  if (specifier.startsWith("@/")) {
    candidateSpecifier = `./${specifier.slice(2)}`;
    base = REPO_ROOT;
  } else if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return nextResolve(specifier, context);
  }

  const hasExtension = /\.[a-zA-Z0-9]+$/.test(candidateSpecifier);
  if (!hasExtension) {
    for (const suffix of [".ts", "/index.ts"]) {
      const candidateUrl = new URL(`${candidateSpecifier}${suffix}`, base);
      if (existsSync(fileURLToPath(candidateUrl))) {
        return nextResolve(candidateUrl.href, { ...context, parentURL: base });
      }
    }
  }
  return nextResolve(new URL(candidateSpecifier, base).href, { ...context, parentURL: base });
}
