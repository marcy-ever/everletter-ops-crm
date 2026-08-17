// Node's native TS loader (--experimental-strip-types) requires explicit
// file extensions on relative specifiers and doesn't understand the "@/"
// path alias, but this repo's application code uses extensionless
// specifiers and "@/" imports throughout (tsconfig.json's paths: {"@/*":
// ["./*"]}, moduleResolution: "bundler" - explicit .ts extensions are a
// type error there without allowImportingTsExtensions, which isn't and
// shouldn't be enabled just to satisfy a test runner). This loader hook
// bridges the two so tests can import real application .ts files (e.g.
// lib/write-to-tables.ts, lib/build-dataset-from-tables.ts) directly instead of
// needing a throwaway scratch copy with rewritten imports:
//  - "@/x" is remapped to the repo root, same as tsconfig.json's paths.
//  - a relative or remapped specifier with no extension that doesn't
//    resolve as-is is retried with ".ts" appended, then ".tsx", then
//    "/index.ts" and "/index.tsx" (for directory-style imports like
//    "../db" -> "../db/index.ts").
// Test-only infrastructure - never touches application source or tsconfig.
//
// .tsx files (added for the app.js decomposition's Phase 1 - CLAUDE.md -
// once a view migrates to a real React component, its test needs to
// import and render actual JSX) need a second, separate thing this file
// didn't do before: a real *transform*, not just extension resolution.
// --experimental-strip-types only erases TypeScript's type syntax
// character-for-character; it has no JSX compiler and can't turn `<div/>`
// into a `jsx(...)` call, so loading a .tsx file through Node's own
// default handling either throws or (worse) silently misparses JSX as
// something else. The `load` hook below intercepts .tsx specifically -
// nothing else - and compiles it with the `typescript` package (already a
// pinned devDependency, used for `pnpm typecheck`; adding esbuild or any
// other bundler here would mean depending on a transitive tool version
// nothing in package.json actually pins) via `ts.transpileModule()`, the
// same single-file, no-cross-file-type-info compile `isolatedModules:
// true` in tsconfig.json already commits this codebase to. JSX mode
// (`react-jsx`) and `esModuleInterop` are read directly from
// tsconfig.json so this can never silently drift from what `pnpm
// typecheck`/`pnpm build` actually compile against. Every other
// extension's loading is completely untouched - this hook reads the file
// itself for .tsx (never calling `nextLoad`, so Node's own .tsx handling,
// whatever it is, is never reached) and defers immediately for anything
// else.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

const REPO_ROOT_PATH = path.resolve(import.meta.dirname, "..");
const tsconfig = ts.readConfigFile(path.join(REPO_ROOT_PATH, "tsconfig.json"), ts.sys.readFile);
// parseJsonConfigFileContent resolves "jsx": "react-jsx" (a string in the
// raw JSON) into ts.JsxEmit.ReactJSX (the enum transpileModule needs) -
// reading the raw JSON field directly instead would require duplicating
// that string-to-enum mapping by hand here.
const { options: TSCONFIG_COMPILER_OPTIONS } = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, REPO_ROOT_PATH);

const REPO_ROOT = pathToFileURL(REPO_ROOT_PATH + "/");

export async function resolve(specifier, context, nextResolve) {
  let candidateSpecifier = specifier;
  let base = context.parentURL;

  if (specifier.startsWith("@/")) {
    candidateSpecifier = `./${specifier.slice(2)}`;
    base = REPO_ROOT;
  } else if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return resolveBareSpecifier(specifier, context, nextResolve);
  }

  const hasExtension = /\.[a-zA-Z0-9]+$/.test(candidateSpecifier);
  if (!hasExtension) {
    for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const candidateUrl = new URL(`${candidateSpecifier}${suffix}`, base);
      if (existsSync(fileURLToPath(candidateUrl))) {
        return nextResolve(candidateUrl.href, { ...context, parentURL: base });
      }
    }
  }
  return nextResolve(new URL(candidateSpecifier, base).href, { ...context, parentURL: base });
}

// See the module comment above for why .tsx needs a real transform, not
// just extension resolution. Reads the file itself and never calls
// nextLoad for a .tsx URL - Node's own default handling of that
// extension is never reached, so there's no risk of it choking on JSX
// before this hook gets a chance to compile it. Every other extension
// falls straight through to nextLoad, unmodified - this can only ever
// change behavior for .tsx files, which no test imported before this.
export async function load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) {
    return nextLoad(url, context);
  }
  const source = readFileSync(fileURLToPath(url), "utf8");
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { ...TSCONFIG_COMPILER_OPTIONS, jsx: ts.JsxEmit.ReactJSX },
    fileName: fileURLToPath(url),
    reportDiagnostics: true,
  });
  if (diagnostics && diagnostics.length) {
    // transpileModule only ever reports syntactic errors (it has no
    // cross-file type information to report type errors with - the same
    // isolatedModules limitation tsconfig.json already accepts) - a real
    // hit here means the file doesn't even parse, which pnpm typecheck's
    // separate full-program compile would catch anyway, but surfacing it
    // here with the actual file/message is far more useful than a
    // confusing downstream SyntaxError from the resulting broken output.
    const message = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => REPO_ROOT_PATH,
      getNewLine: () => "\n",
    });
    throw new Error(`Failed to compile ${fileURLToPath(url)}:\n${message}`);
  }
  return { format: "module", source: outputText, shortCircuit: true };
}

// Surfaced by auth.ts becoming reachable from app/api/shared-state/route.ts
// (the audit-log task's actor capture) - next-auth's own package imports
// "next/server" with no extension (next-auth/lib/env.js), which only
// resolves under Next's own bundler (webpack/turbopack, under `next dev`/
// `next build`), not under plain Node ESM resolution: `next`'s
// package.json has no "exports" map, and Node's ESM resolver (unlike
// CJS require()) never guesses an extension on a bare specifier. The real
// file is one extension away (Node's own error names it: "Did you mean to
// import next/server.js?"), so that's retried here before giving up -
// narrowly scoped to bare subpath specifiers (must contain "/", so a
// package's own root entry point, which resolves via "main"/"exports"
// normally, is untouched) so this can't mask a genuinely missing module.
async function resolveBareSpecifier(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isModuleNotFound = error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND";
    const isExtensionlessSubpath = specifier.includes("/") && !/\.[a-zA-Z0-9]+$/.test(specifier);
    if (isModuleNotFound && isExtensionlessSubpath) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw error;
  }
}
