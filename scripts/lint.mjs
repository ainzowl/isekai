#!/usr/bin/env node
// "No forbidden syntax" check: protects the runtime-portability promise
// (ES2020-safe, no node builtins, no bundler, works on QuickJS-ng & friends).
// Usage: node scripts/lint.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  [/\.at\s*\(/, ".at() is ES2022 — not allowed"],
  [/\?\?=/, "??= is ES2021 — not allowed"],
  [/\|\|=/, "||= is ES2021 — not allowed"],
  [/&&=/, "&&= is ES2021 — not allowed"],
  [/from\s+["']node:/, "node: imports are not allowed in src/"],
  [/\brequire\s*\(/, "require() is not allowed in src/"],
  [/\bstructuredClone\b/, "structuredClone is not portable"],
  [/^await\s/m, "top-level await is not allowed in src/"],
  [/\bprocess\./, "process.* is a Node-only global"],
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

let failures = 0;
for (const file of walk("src")) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (const [pattern, message] of FORBIDDEN) {
    lines.forEach((line, i) => {
      if (line.indexOf("//") === 0) return;
      if (pattern.test(line)) {
        console.error(file + ":" + (i + 1) + "  " + message + "  ->  " + line.trim());
        failures++;
      }
    });
  }
}

if (failures) {
  console.error("\nlint: " + failures + " forbidden pattern(s)");
  process.exit(1);
}
console.log("lint: src/ is clean (ES2020-safe, no node builtins)");
