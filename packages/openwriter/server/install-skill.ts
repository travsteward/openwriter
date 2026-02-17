import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function installSkill(): void {
  const source = path.join(__dirname, '../../skill/SKILL.md');
  const targetDir = path.join(os.homedir(), '.claude', 'skills', 'openwriter');
  const target = path.join(targetDir, 'SKILL.md');

  if (!fs.existsSync(source)) {
    console.error(`Error: SKILL.md not found at ${source}`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(source, target);

  console.error(`Installed OpenWriter skill to ${target}`);
  process.exit(0);
}
