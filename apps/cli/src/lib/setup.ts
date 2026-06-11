import fs from 'node:fs';
import { resolve } from 'node:path';

const LOOPY_DIR = '.loopy';
const SUBDIRS = ['state', 'worktrees', 'logs'];

export function ensureLoopyDirs(basePath?: string): string {
  const base = basePath ? resolve(basePath, LOOPY_DIR) : resolve(LOOPY_DIR);
  for (const subdir of SUBDIRS) {
    const dir = resolve(base, subdir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  return base;
}