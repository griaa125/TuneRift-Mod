const { app, BrowserWindow, session, ipcMain, Menu, shell, nativeImage, webFrameMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const { initDiscordRPC, updateActivity, clearActivity, setDiscordEnabled } = require('./discordRPC');
const { loadAddons, getAddonManifests, injectEnabledAddons, injectAddon } = require('./addonLoader');

// Убираем шумные Chromium/EGL-сообщения из stderr. Логи приложения
// (Discord RPC, Ynison и аддоны) продолжают выводиться через console.*.
app.commandLine.appendSwitch('disable-logging');
app.commandLine.appendSwitch('log-level', '3');

// Чтобы сломанный аддон/расширение не мог тихо обрушить весь main-процесс
process.on('uncaughtException', (err) => {
  console.error('[main] Необработанная ошибка (приложение продолжает работать):', err);
});

const store = new Store({
  defaults: {
    addons: {},          // { addonId: true/false }
    discordEnabled: true,
    newDesign: false,
    loadExtensions: true,
    stationAudioEnabled: false,
    stationAutoConnect: false,
    stationDeviceHint: 'station,yandex,alice,яндекс',
    stationMonitorVolume: 0.02,
    windowBounds: null   // { width, height, x, y } — сохранённый размер/позиция окна
  }
});

const EXT_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'extensions')
  : path.join(__dirname, '..', 'extensions');
const ADDON_DIR = path.join(__dirname, '..', 'addons');
// PNG — для окон и панели задач; ICNS — нативный формат значка Dock в macOS.
const APP_ICON_PATH = path.join(__dirname, '..', 'build', 'ym_logo.png');
const APP_ICON_MAC_PATH = path.join(__dirname, '..', 'build', 'icon.icns');

let mainWindow;
let settingsWindow;
let lastYnisonTimeline = null;

function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log('[updater] Проверка пропущена в режиме разработки');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => console.log('[updater] Проверяю обновления...'));
  autoUpdater.on('update-available', (info) => console.log(`[updater] Найдена версия ${info.version}, начинаю загрузку`));
  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(Math.max(0, Math.min(1, progress.percent / 100)));
    console.log(`[updater] Загрузка: ${progress.percent.toFixed(1)}%`);
  });
  autoUpdater.on('update-not-available', () => console.log('[updater] Установлена последняя версия'));
  autoUpdater.on('error', (error) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
    console.warn('[updater] Ошибка проверки/загрузки:', error.message || error);
  });
  autoUpdater.on('update-downloaded', async (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Доступно обновление TuneRift',
      message: `Версия ${info.version} скачана и готова к установке.`,
      detail: 'Перезапустить приложение сейчас или установить обновление при следующем запуске?',
      buttons: ['Перезапустить сейчас', 'Позже'],
      defaultId: 0,
      cancelId: 1
    });
    if (result.response === 0) autoUpdater.quitAndInstall(false, true);
  });

  setTimeout(() => autoUpdater.checkForUpdates().catch((error) => {
    console.warn('[updater] Не удалось проверить обновления:', error.message || error);
  }), 5000);
}

function broadcastPlayerSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('tunerift:player-settings', {
    stationAudioEnabled: Boolean(store.get('stationAudioEnabled') || store.get('stationAutoConnect')),
    stationAutoConnect: Boolean(store.get('stationAutoConnect')),
    stationDeviceHint: String(store.get('stationDeviceHint') || ''),
    stationMonitorVolume: Number(store.get('stationMonitorVolume'))
  });
}

function getStationHints() {
  return String(store.get('stationDeviceHint') || 'station,yandex,alice,яндекс')
    .split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
}

function matchesStation(text) {
  const lower = String(text || '').toLowerCase();
  return getStationHints().some((hint) => lower.includes(hint));
}

function notifyStationConnectionError(message) {
  if (!mainWindow || mainWindow.isDestroyed() || !store.get('stationAutoConnect')) return;
  mainWindow.webContents.send('tunerift:station-connect-error', { message });
}

function autoConnectStation() {
  if (!store.get('stationAutoConnect')) return;

  if (process.platform === 'darwin') {
    const blueutil = ['/opt/homebrew/bin/blueutil', '/usr/local/bin/blueutil', 'blueutil']
      .find((candidate) => candidate === 'blueutil' || fs.existsSync(candidate));
    if (!blueutil) {
      notifyStationConnectionError('На macOS не найден blueutil. Установите его командой: brew install blueutil.');
      return;
    }
    execFile(blueutil, ['--paired', '--format', 'json'], (error, stdout = '') => {
      let devices = [];
      try {
        const parsed = JSON.parse(stdout);
        devices = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.devices) ? parsed.devices : []);
      } catch {
        devices = String(stdout).split('\n').map((line) => ({ raw: line, name: line }));
      }
      const device = devices.find((item) => matchesStation(`${item.name || ''} ${item.address || ''} ${item.raw || ''}`));
      const address = device?.address || device?.mac || String(device?.raw || '').match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i)?.[0];
      if (error || !address) {
        const message = 'Не удалось автоматически подключить Станцию на macOS. Убедитесь, что она сопряжена и подключена в Bluetooth.';
        console.warn(`[station-audio] ${message}`);
        notifyStationConnectionError(message);
        return;
      }
      execFile(blueutil, ['--connect', address], (connectError) => {
        if (connectError) {
          console.warn('[station-audio] macOS: не удалось подключить Станцию:', connectError.message);
          notifyStationConnectionError('Не удалось подключить Станцию по Bluetooth на macOS. Проверьте, что устройство доступно.');
        } else {
          execFile(blueutil, ['--wait-connect', address, '10'], (waitError) => {
            if (waitError) notifyStationConnectionError('macOS не подтвердил подключение Станции по Bluetooth.');
            else console.log(`[station-audio] macOS: Станция подключена (${address})`);
          });
        }
      });
    });
    return;
  }

  if (process.platform === 'linux') {
    execFile('bluetoothctl', ['devices'], (error, stdout = '') => {
      const line = String(stdout).split('\n').find((item) => matchesStation(item));
      const address = line?.match(/(?:[0-9a-f]{2}:){5}[0-9a-f]{2}/i)?.[0];
      if (error || !address) {
        const message = 'Не удалось автоматически найти Станцию на Linux. Убедитесь, что bluetoothctl видит сопряжённое устройство.';
        console.warn(`[station-audio] ${message}`);
        notifyStationConnectionError(message);
        return;
      }
      execFile('bluetoothctl', ['connect', address], (connectError, connectOutput = '') => {
        if (connectError) {
          console.warn('[station-audio] Linux: не удалось подключить Станцию:', connectOutput || connectError.message);
          notifyStationConnectionError('Не удалось подключить Станцию по Bluetooth на Linux. Проверьте состояние Bluetooth.');
        }
        else console.log(`[station-audio] Linux: Станция подключена (${address})`);
      });
    });
    return;
  }

  // Windows не предоставляет штатной CLI-команды для подключения A2DP.
  // Открываем системную панель: после подключения Station Mode уже работает
  // одинаково через Media Session и выбранный audiooutput.
  if (process.platform === 'win32') {
    const message = 'Windows не смог автоматически подключить Станцию. Подключите её вручную в системном Bluetooth — TuneRift подхватит её после подключения.';
    console.warn(`[station-audio] ${message}`);
    notifyStationConnectionError(message);
  }
}

function hasValidTimeline(data) {
  const durationMs = Number(data?.durationMs);
  const positionMs = Number(data?.positionMs);
  return Number.isFinite(durationMs) && durationMs > 0
    && Number.isFinite(positionMs) && positionMs >= 0 && positionMs < durationMs;
}

function rememberYnisonTimeline(track) {
  lastYnisonTimeline = {
    title: track.title,
    durationMs: Number(track.durationMs),
    positionMs: Number(track.positionMs),
    isPlaying: Boolean(track.isPlaying),
    updatedAt: Date.now()
  };
}

function getTimelineForTrack(title, isPlaying) {
  if (!lastYnisonTimeline) return null;
  const now = Date.now();
  // Обычно названия совпадают. При смене трека MediaSession может обновиться
  // раньше Ynison, поэтому чужой кэш допускается только первые 3 секунды.
  if (lastYnisonTimeline.title !== title && now - lastYnisonTimeline.updatedAt > 3000) return null;

  const elapsedMs = lastYnisonTimeline.isPlaying ? Math.max(0, now - lastYnisonTimeline.updatedAt) : 0;
  const positionMs = Math.min(
    lastYnisonTimeline.durationMs,
    lastYnisonTimeline.positionMs + elapsedMs
  );
  return {
    ...lastYnisonTimeline,
    positionMs,
    isPlaying: Boolean(isPlaying)
  };
}

function createMainWindow() {
  const saved = store.get('windowBounds');
  mainWindow = new BrowserWindow({
    width: saved?.width || 1280,
    height: saved?.height || 820,
    x: saved?.x,
    y: saved?.y,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 10 } } : {}),
    ...(process.platform !== 'darwin' ? { titleBarOverlay: { color: '#000000', symbolColor: '#ffffff', height: 32 } } : {}),
    title: 'Яндекс Музыка',
    backgroundColor: '#000000',
    icon: APP_ICON_PATH,
    webPreferences: {
      partition: 'persist:ymelectron',
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // выключено, т.к. аддонам нужен executeJavaScript в MAIN world
    }
  });

  // Сохраняем размер/позицию с небольшой задержкой (не на каждый пиксель при ресайзе)
  let saveTimeout = null;
  const scheduleSave = () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      store.set('windowBounds', mainWindow.getBounds());
    }, 400);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) store.set('windowBounds', mainWindow.getBounds());
  });

  mainWindow.loadURL('https://music.yandex.ru');
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle('Яндекс Музыка');
  });

  // Раньше вызывали инъекцию и на dom-ready, и на did-finish-load "для надёжности" —
  // но это заставляет скрипты аддонов (например FckCensor) выполняться ДВАЖДЫ за
  // одну загрузку страницы, что ломает их внутренние one-time хуки (DI-перехват
  // и т.п.). Возвращаемся к одному триггеру; race-condition при первом запуске
  // теперь лечится retry-логикой внутри самих аддонов (self-healing).
  let injectedForCurrentNav = false;
  mainWindow.webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
    if (isMainFrame) injectedForCurrentNav = false;
  });
  mainWindow.webContents.on('dom-ready', () => {
    if (injectedForCurrentNav) return;
    injectedForCurrentNav = true;
    console.log(`[main] Инъекция аддонов, URL: ${mainWindow.webContents.getURL()}`);
    injectEnabledAddons(mainWindow.webContents, store.get('addons'), ADDON_DIR);
  });

  // Account menu is rendered inside the yandex.ru/user-id frame, not in the
  // top-level music.yandex.ru document. Inject only the account-menu addon there.
  mainWindow.webContents.on('did-frame-finish-load', (_event, isMainFrame, frameProcessId, frameRoutingId) => {
    if (isMainFrame) return;
    try {
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
      const url = frame?.url || '';
      if (!frame || !String(url).startsWith('https://yandex.ru/user-id')) return;
      console.log('[main] Account iframe detected, injecting Yandex Music menu:', url);
      injectAddon(frame, 'tunerift-account-menu', ADDON_DIR, store.get('addons'));
    } catch (err) {
      console.error('[main] Account iframe injection failed:', err.message || err);
    }
  });

  // Внешние ссылки — в системный браузер
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  buildMenu();
}

function createSettingsWindow() {
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    title: 'Настройки',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'settingsPreload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWindow.setMenu(null);
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function buildMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Яндекс Музыка',
      submenu: [
        { label: 'Перезагрузить', click: () => mainWindow.reload() },
        { label: 'DevTools', accelerator: 'CmdOrCtrl+Alt+I', click: () => mainWindow.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: 'Выход', role: 'quit' }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', role: 'undo' },
        { label: 'Повторить', role: 'redo' },
        { type: 'separator' },
        { label: 'Вырезать', role: 'cut' },
        { label: 'Копировать', role: 'copy' },
        { label: 'Вставить', role: 'paste' },
        { label: 'Выделить всё', role: 'selectAll' }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

// --- Загрузка Chrome-расширений (unpacked) ---
async function loadUnpackedExtensions() {
  console.log('[extensions] loadExtensions setting =', store.get('loadExtensions'));
  console.log('[extensions] Ищу расширения в:', EXT_DIR);
  if (!store.get('loadExtensions')) { console.log('[extensions] Загрузка отключена в настройках'); return; }
  if (!fs.existsSync(EXT_DIR)) { console.log('[extensions] Папка не найдена!'); return; }
  const allEntries = fs.readdirSync(EXT_DIR);
  console.log('[extensions] Содержимое папки extensions/:', allEntries);
  const dirs = fs.readdirSync(EXT_DIR).filter(d => {
    const full = path.join(EXT_DIR, d);
    return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'manifest.json'));
  });
  console.log('[extensions] Папки с manifest.json найдены:', dirs);
  for (const d of dirs) {
    try {
      const manifestPath = path.join(EXT_DIR, d, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const ext = await session.fromPartition('persist:ymelectron').loadExtension(path.join(EXT_DIR, d), { allowFileAccess: true });
      console.log(`Загружено расширение: ${ext.name} (manifest_version: ${manifest.manifest_version})`);
      if (manifest.manifest_version === 3) {
        console.log('  ⚠️ MV3: content_scripts должны сработать, но фоновый service_worker и chrome.scripting могут не работать в Electron.');
      }
      if (manifest.content_scripts) {
        const matches = manifest.content_scripts.flatMap(cs => cs.matches || []);
        console.log('  content_scripts matches:', matches);
      }
    } catch (e) {
      console.error('Не удалось загрузить расширение', d, e);
    }
  }
}

// --- IPC: настройки аддонов ---
ipcMain.handle('addons:list', () => getAddonManifests(ADDON_DIR, store.get('addons')));
ipcMain.handle('addons:toggle', (e, id, enabled) => {
  const addons = { ...store.get('addons') };
  addons[id] = Boolean(enabled);
  store.set('addons', addons);
  if (mainWindow) mainWindow.reload(); // проще всего применить — перезагрузка страницы
  return true;
});

ipcMain.handle('settings:get', () => ({
  discordEnabled: store.get('discordEnabled'),
  newDesign: store.get('newDesign'),
  loadExtensions: store.get('loadExtensions'),
  stationAudioEnabled: store.get('stationAudioEnabled'),
  stationAutoConnect: store.get('stationAutoConnect'),
  stationDeviceHint: store.get('stationDeviceHint'),
  stationMonitorVolume: store.get('stationMonitorVolume')
}));
ipcMain.handle('settings:set', (e, key, value) => {
  store.set(key, value);
  if (key === 'discordEnabled') setDiscordEnabled(value);
  if (key === 'newDesign' && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(`localStorage.setItem('tunerift:use-new-design', ${Boolean(value)} ? 'true' : 'false'); location.reload();`, true).catch(err => console.error('[main] new design apply failed:', err.message || err));
  }
  if (key === 'stationAudioEnabled' || key === 'stationAutoConnect' || key === 'stationDeviceHint' || key === 'stationMonitorVolume') {
    mainWindow?.webContents.send('tunerift:station-audio-settings', {
      enabled: Boolean(store.get('stationAudioEnabled') || store.get('stationAutoConnect')),
      stationAutoConnect: Boolean(store.get('stationAutoConnect')),
      deviceHint: String(store.get('stationDeviceHint') || ''),
      monitorVolume: Number(store.get('stationMonitorVolume'))
    });
  }
  return true;
});

// --- IPC: данные о треке из preload'а страницы -> Discord RPC ---
ipcMain.on('nowplaying:update', (e, data) => {
  if (!store.get('discordEnabled')) return;
  if (!data || !data.title) { clearActivity(); return; }

  // Ynison и MediaSession приходят не синхронно: Ynison уже знает длительность,
  // когда MediaSession ещё кратко сообщает isPlaying=false или duration=0.
  // Запоминаем валидный таймлайн по названию трека и объединяем его только с
  // последующим обновлением этого же трека.
  if (hasValidTimeline(data)) rememberYnisonTimeline(data);
  const cachedTimeline = hasValidTimeline(data) ? null : getTimelineForTrack(data.title, data.isPlaying);
  const activityData = cachedTimeline
    ? { ...data, durationMs: cachedTimeline.durationMs, positionMs: cachedTimeline.positionMs }
    : data;

  // После первого MediaSession-подтверждения playing запоминаем кэш как
  // продолжающийся, чтобы следующие обновления сохраняли движущийся таймлайн.
  if (cachedTimeline && data.isPlaying) {
    lastYnisonTimeline = {
      ...cachedTimeline,
      isPlaying: true,
      updatedAt: Date.now()
    };
  }

  if (cachedTimeline && !hasValidTimeline(data)) {
    console.log('[tunerift-ynison] timeline-cache-hit', {
      track: data.title,
      durationMs: cachedTimeline.durationMs,
      positionMs: cachedTimeline.positionMs,
      isPlaying: data.isPlaying
    });
  }
  updateActivity(activityData);
});

ipcMain.on('tunerift:ynison-diagnostic', (_event, data) => {
  console.log('[tunerift-ynison]', data);
});

// Кнопка "Настройки приложения" в профиле (см. addons/ui-tweaks)
ipcMain.on('open-settings-window', () => createSettingsWindow());

// Иконка приложения в Dock macOS. ICNS предпочтительнее, PNG остаётся резервным вариантом.
function applyDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) return;
  const dockIconPath = fs.existsSync(APP_ICON_MAC_PATH) ? APP_ICON_MAC_PATH : APP_ICON_PATH;
  if (!fs.existsSync(dockIconPath)) {
    console.warn(`[icon] Не найден файл для Dock: ${dockIconPath}`);
    return;
  }
  try {
    app.dock.setIcon(dockIconPath);
    console.log(`[icon] Иконка Dock установлена: ${dockIconPath}`);
  } catch (error) {
    console.warn(`[icon] Не удалось установить иконку Dock: ${error.message || error}`);
  }
}

app.whenReady().then(async () => {
  applyDockIcon();

  // Точечно расширяем CSP вместо того, чтобы сносить его целиком — это и
  // безопаснее, и не ломает логику самого сайта (например, вход по Face ID/
  // Touch ID использует WebAuthn, который может зависеть от исходного CSP —
  // полное удаление заголовка приводило к зависанию экрана входа).
  // Добавляем только домены, которые реально нужны сторонним аддонам для
  // сетевых запросов (cdn.jsdelivr.net, raw.githubusercontent.com — под
  // GitHub-хостинг данных для аддонов вроде FckCensor). Если тебе нужен ещё
  // какой-то домен для другого аддона — просто добавь его в этот список.
  const EXTRA_CONNECT_SRC_DOMAINS = [
    'https://cdn.jsdelivr.net',
    'https://raw.githubusercontent.com',
    'https://api.github.com',
    'https://lrclib.net',
    'http://localhost:2007'
  ];

  const ymSession = session.fromPartition('persist:ymelectron');
  ymSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    const cspKey = Object.keys(headers).find(k => k.toLowerCase() === 'content-security-policy');

    if (cspKey) {
      let csp = headers[cspKey][0];
      if (csp.includes('connect-src')) {
        // Вставляем наши домены сразу после "connect-src"
        csp = csp.replace(/connect-src/, 'connect-src ' + EXTRA_CONNECT_SRC_DOMAINS.join(' '));
      } else {
        // На случай если connect-src в политике вообще отсутствует
        csp += "; connect-src 'self' " + EXTRA_CONNECT_SRC_DOMAINS.join(' ');
      }
      headers[cspKey] = [csp];
    }

    callback({ responseHeaders: headers });
  });

  await loadUnpackedExtensions();
  createMainWindow();
  broadcastPlayerSettings();
  autoConnectStation();
  initDiscordRPC(store.get('discordEnabled'));
  setupAutoUpdater();
});

app.on('will-quit', () => {
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
