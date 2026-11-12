// Usage: node tools/set-backup-folder.mjs "G:\My Drive\DocuVault Backups"
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = process.argv.slice(2).join(' ').trim().replace(/^"|"$/g, '');
if (!dir) { console.log('Give the folder path, e.g. "G:\\My Drive\\DocuVault Backups"'); process.exit(1); }
const data = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(data, { recursive: true });
const file = path.join(data, 'config.json');
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* new */ }
fs.mkdirSync(dir, { recursive: true });
cfg.backupDir = path.resolve(dir);
fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
console.log('Backups will be saved to: ' + cfg.backupDir + '\nRestart the DocuVault server for this to take effect.');
