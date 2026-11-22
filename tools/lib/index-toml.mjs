// Helpers for pack/index.toml.
import fs from 'node:fs';
import path from 'node:path';
import { P, readTOML, tomlStringify, matchAny } from './util.mjs';

const IDX = () => path.join(P.pack, 'index.toml');
export const readIndex = () => readTOML(IDX());

/** Ensure `preserve = true` exactly on index entries matching globs. Returns changed count. */
export function setPreserve(globs) {
  const idx = readIndex();
  let changed = 0;
  for (const f of idx.files || []) {
    const want = matchAny(f.file, globs);
    if (want && !f.preserve) { f.preserve = true; changed++; }
    if (!want && f.preserve) { delete f.preserve; changed++; }
  }
  if (changed) fs.writeFileSync(IDX(), tomlStringify(idx) + '\n');
  return changed;
}
