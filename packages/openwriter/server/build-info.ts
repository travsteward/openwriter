import { readFileSync } from 'fs';

// Capture once when this process loads. An old process must never report a
// newly written build stamp while it is still running old server code.
// adr: adr/delivery-system.md
export const buildInfo = (() => {
  try {
    const stamp = JSON.parse(readFileSync(new URL('../build-info.json', import.meta.url), 'utf8'));
    return { ...stamp, startedAt: new Date().toISOString() };
  } catch {
    return { sha: null, verified: false, startedAt: new Date().toISOString() };
  }
})();
