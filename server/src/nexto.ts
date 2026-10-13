import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setNextoWeights, nextoReady } from '../../client/src/rocket/sim/nexto';

/** Node (server / tools): load the Nexto weights from client/public (or a built client/dist). False if missing. */
export function loadNextoFromDisk(): boolean {
  if (nextoReady()) return true;
  for (const rel of ['../../client/public/assets/nexto/nexto.bin', '../../client/dist/assets/nexto/nexto.bin']) {
    const file = fileURLToPath(new URL(rel, import.meta.url));
    if (!existsSync(file)) continue;
    const buf = readFileSync(file);
    setNextoWeights(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
    return true;
  }
  return false;
}
