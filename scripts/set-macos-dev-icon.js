const fs = require('fs');
const path = require('path');

// При npm start на macOS запускается Electron.app из node_modules.
// Dock читает его встроенный electron.icns, поэтому подменяем ресурс до старта приложения.
if (process.platform !== 'darwin') process.exit(0);

const sourceIcon = path.join(__dirname, '..', 'build', 'ym_logo.icns');
const electronExecutable = require('electron');
const electronResources = path.resolve(path.dirname(electronExecutable), '..', 'Resources');
const targetIcon = path.join(electronResources, 'electron.icns');
const backupIcon = path.join(electronResources, 'electron.icns.ymelectron-backup');

if (!fs.existsSync(sourceIcon)) {
  console.error(`[icon] Не найден файл иконки: ${sourceIcon}`);
  process.exit(1);
}

if (!fs.existsSync(targetIcon)) {
  console.error(`[icon] Не найден ресурс Electron.app: ${targetIcon}`);
  process.exit(1);
}

if (!fs.existsSync(backupIcon)) {
  fs.copyFileSync(targetIcon, backupIcon);
}

fs.copyFileSync(sourceIcon, targetIcon);
console.log(`[icon] Иконка Dock обновлена: ${targetIcon}`);
