import {readdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';

const ESM_DIR = 'dist/esm';

function walk(dir) {
  const results = [];
  const entries = readdirSync(dir, {withFileTypes: true});
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(path));
    else if (entry.name.endsWith('.js')) results.push(path);
  }
  return results;
}

function resolveImport(importPath, fromFile) {
  if (importPath.endsWith('.js') || importPath.endsWith('.mjs') || importPath.endsWith('.cjs')) {
    return importPath;
  }

  const fromDir = dirname(fromFile);
  const candidateFile = join(fromDir, importPath + '.js');
  const candidateIndex = join(fromDir, importPath, 'index.js');

  if (existsSync(candidateIndex)) return importPath + '/index.js';
  if (existsSync(candidateFile)) return importPath + '.js';

  return importPath + '.js';
}

const files = walk(ESM_DIR);

for (const filePath of files) {
  let content = readFileSync(filePath, 'utf8');
  let modified = false;

  content = content.replace(
    /(export\s+\*\s+from\s+['"])(\.\.?\/[^'"]+?)(['"];)/g,
    (match, prefix, importPath, suffix) => {
      const resolved = resolveImport(importPath, filePath);
      if (resolved !== importPath) {
        modified = true;
        return `${prefix}${resolved}${suffix}`;
      }
      return match;
    }
  );

  content = content.replace(
    /(from\s+['"])(\.\.?\/[^'"]+?)(['"];)/g,
    (match, prefix, importPath, suffix) => {
      const resolved = resolveImport(importPath, filePath);
      if (resolved !== importPath) {
        modified = true;
        return `${prefix}${resolved}${suffix}`;
      }
      return match;
    }
  );

  if (modified) {
    writeFileSync(filePath, content, 'utf8');
  }
}