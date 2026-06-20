import fs from 'fs';
import path from 'path';

const assetsDir = path.join(process.cwd(), 'public', 'assets');
let files: string[] = [];

function getFiles(dir: string) {
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getFiles(fullPath);
    } else {
      files.push(fullPath.replace(path.join(process.cwd(), 'public'), '').replace(/\\/g, '/'));
    }
  }
}

getFiles(assetsDir);
fs.writeFileSync('src/assetMap.ts', 'export const ASSET_MAP = ' + JSON.stringify(files, null, 2) + ';');
