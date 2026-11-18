const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const platformBinary = process.platform === 'darwin'
  ? path.join(electronDir, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : process.platform === 'win32'
    ? path.join(electronDir, 'dist', 'electron.exe')
    : path.join(electronDir, 'dist', 'electron');

if (fs.existsSync(platformBinary)) process.exit(0);

function run(command, args, options = {}) {
  return spawnSync(command, args, { stdio: 'inherit', ...options });
}

function macArch() {
  if (process.arch !== 'x64') return process.arch;
  try {
    const translated = spawnSync('sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' });
    if (translated.stdout?.trim() === '1') return 'arm64';
  } catch {}
  return 'x64';
}

function directDownload() {
  const electronPackage = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'));
  const version = electronPackage.version;
  const platform = process.platform;
  const arch = platform === 'darwin' ? macArch() : process.arch;
  const platformName = platform === 'win32' ? 'win32' : platform;
  const extension = platform === 'win32' ? 'zip' : 'zip';
  const fileName = `electron-v${version}-${platformName}-${arch}.${extension}`;
  const mirrors = [
    `https://npmmirror.com/mirrors/electron/${version}/${fileName}`,
    `https://mirrors.huaweicloud.com/electron/${version}/${fileName}`
  ];
  const cacheDir = path.join(os.tmpdir(), 'tunerift-electron-download');
  const archive = path.join(cacheDir, fileName);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(path.join(electronDir, 'dist'), { recursive: true });

  for (const url of mirrors) {
    console.log(`[electron] Прямая загрузка: ${url}`);
    const download = run('curl', ['-L', '--fail', '--retry', '2', '--connect-timeout', '15', '-o', archive, url]);
    if (download.status !== 0 || !fs.existsSync(archive) || fs.statSync(archive).size < 1000000) continue;
    const extract = run('unzip', ['-q', '-o', archive, '-d', path.join(electronDir, 'dist')]);
    if (extract.status === 0 && fs.existsSync(platformBinary)) {
      fs.writeFileSync(path.join(electronDir, 'path.txt'), platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron');
      console.log(`[electron] Electron ${version} установлен напрямую (${platform}/${arch}).`);
      return true;
    }
  }
  return false;
}

const installer = path.join(electronDir, 'install.js');
if (!fs.existsSync(installer)) {
  console.error('[electron] Пакет Electron не найден. Сначала выполните npm install.');
  process.exit(1);
}

console.warn('[electron] Бинарник не найден — запускаю восстановление Electron...');
const env = { ...process.env };
// Для запуска проекта бинарник обязателен. Если переменная случайно попала
// в окружение или npm-конфигурацию, не оставляем установку полусломанной.
delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
delete env.npm_config_electron_skip_binary_download;
// GitHub Release Assets у некоторых провайдеров недоступны или загружаются
// крайне медленно. Это официально поддерживаемый Electron mirror.
env.ELECTRON_MIRROR ||= 'https://npmmirror.com/mirrors/electron/';
env.ELECTRON_CUSTOM_DIR ||= '{{ version }}';

const result = spawnSync(process.execPath, [installer], {
  cwd: electronDir,
  env,
  stdio: 'inherit'
});

if (result.error) {
  console.error('[electron] Не удалось запустить установщик:', result.error.message);
  process.exit(1);
}
if (result.status !== 0 || !fs.existsSync(platformBinary)) {
  console.warn('[electron] Стандартная загрузка не сработала, пробую прямую загрузку архива...');
  if (directDownload()) process.exit(0);
  console.error('[electron] Бинарник не скачан ни одним способом.');
  console.error('[electron] Если зеркала блокируются, скачайте архив Electron вручную и распакуйте его в node_modules/electron/dist.');
  process.exit(result.status || 1);
}

console.log('[electron] Бинарник Electron восстановлен.');
