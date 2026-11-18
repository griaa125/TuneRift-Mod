const { ipcRenderer, contextBridge } = require('electron');
const os = require('os');
const crypto = require('crypto');

// The Ynison desktop connector distinguishes an Electron desktop client from
// a regular web tab through these early page-world values. They mirror only
// the small device-info contract used by the original mod; no account data is
// exposed to the page.
const tuneRiftDeviceId = `tunerift-${crypto.createHash('sha256')
  .update(`${os.hostname()}|${os.userInfo().username}|TuneRift`)
  .digest('hex')
  .slice(0, 32)}`;
const tuneRiftDeviceInfo = {
  manufacturer: 'TuneRift',
  model: 'TuneRift Mod',
  uuid: tuneRiftDeviceId,
  os: process.platform,
  os_version: os.release(),
  device_id: tuneRiftDeviceId,
  clid: 0
};

for (const [name, value] of Object.entries({
  PLATFORM: process.platform,
  DEVICE_HOSTNAME: os.hostname().slice(0, 50).trim(),
  DEVICE_INFO: tuneRiftDeviceInfo
})) {
  try {
    contextBridge.exposeInMainWorld(name, value);
  } catch {
    // A future Yandex build may define a value under the same name. In that
    // case the site-owned value is safer than overwriting it from preload.
  }
}

try {
  contextBridge.exposeInMainWorld('yandexMusicDesktop', {
    openSettings: () => ipcRenderer.send('open-settings-window')
  });
} catch {
  // Не перезаписываем API, если его уже заняла страница.
}

let latestYnisonTiming = null;
let latestNowPlaying = null;

let reportedYnisonTiming = false;

let stationAudioSettings = null;
let stationMirror = null;

function showStationConnectionError(message) {
  const id = 'tunerift-station-connect-error';
  document.getElementById(id)?.remove();
  const toast = document.createElement('div');
  toast.id = id;
  toast.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:420px;padding:14px 42px 14px 16px;border:1px solid rgba(255,90,90,.55);border-radius:12px;background:rgba(35,18,18,.96);box-shadow:0 8px 30px rgba(0,0,0,.35);color:#fff;font:13px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;';
  toast.textContent = `Яндекс Музыка: ${message}`;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Закрыть');
  close.style.cssText = 'position:absolute;top:5px;right:8px;width:26px;height:26px;border:0;background:transparent;color:#fff;opacity:.75;font-size:22px;line-height:22px;cursor:pointer;';
  close.onclick = () => toast.remove();
  toast.appendChild(close);
  document.documentElement.appendChild(toast);
  window.setTimeout(() => toast.remove(), 10000);
}

ipcRenderer.on('tunerift:station-connect-error', (_event, data) => {
  showStationConnectionError(String(data?.message || 'Не удалось подключить Станцию по Bluetooth.'));
});

ipcRenderer.on('tunerift:player-settings', (_event, settings) => {
  applyStationAudioSettings({
    enabled: Boolean(settings?.stationAudioEnabled || settings?.stationAutoConnect),
    deviceHint: settings?.stationDeviceHint,
    monitorVolume: settings?.stationMonitorVolume
  }).catch((error) => console.warn('[station-audio]', error.message || error));
});

function stationHintMatches(label, hint) {
  const normalized = String(label || '').toLowerCase();
  return String(hint || 'station,yandex,alice,яндекс').split(',')
    .map((part) => part.trim().toLowerCase()).filter(Boolean)
    .some((part) => normalized.includes(part));
}

async function findStationOutput(hint) {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.find((device) => device.kind === 'audiooutput' && stationHintMatches(device.label, hint)) || null;
}

function findCurrentAudio() {
  return [...document.querySelectorAll('audio, video')]
    .find((element) => !element.paused && element.readyState >= 2)
    || [...document.querySelectorAll('audio, video')].find((element) => element.readyState >= 2)
    || null;
}

async function connectStationMirror() {
  if (!stationAudioSettings?.enabled) return;
  const media = findCurrentAudio();
  if (!media) return;

  // Один HTMLMediaElement нельзя дважды передать в createMediaElementSource.
  // После выключения режима сохраняем локальную ветку и подключаем только
  // новый скрытый монитор к уже существующему MediaStreamDestination.
  if (stationMirror?.media === media && stationMirror.context && stationMirror.streamDestination) {
    if (stationMirror.monitor) return;
    const device = await findStationOutput(stationAudioSettings.deviceHint);
    if (!device || typeof HTMLMediaElement.prototype.setSinkId !== 'function') return;
    const monitor = document.createElement('audio');
    monitor.autoplay = true;
    monitor.setAttribute('aria-hidden', 'true');
    monitor.style.display = 'none';
    monitor.srcObject = stationMirror.streamDestination.stream;
    document.documentElement.appendChild(monitor);
    try {
      await monitor.setSinkId(device.deviceId);
      await monitor.play();
      stationMirror.monitor = monitor;
      stationMirror.deviceLabel = device.label;
      stationMirror.stationGain.gain.value = Math.max(0.001, Math.min(1, Number(stationAudioSettings.monitorVolume) || 0.02));
      console.log(`[station-audio] Реальный поток снова дублируется на: ${device.label}`);
    } catch (error) {
      monitor.remove();
      console.warn('[station-audio] Не удалось повторно подключить Bluetooth-выход:', error.message || error);
    }
    return;
  }

  const device = await findStationOutput(stationAudioSettings.deviceHint);
  if (!device || typeof HTMLMediaElement.prototype.setSinkId !== 'function') {
    if (!stationMirror?.warningShown) {
      console.warn('[station-audio] Bluetooth-выход не найден или setSinkId не поддерживается');
      stationMirror = { warningShown: true };
    }
    return;
  }

  if (stationMirror?.context) {
    try { await stationMirror.context.close(); } catch {}
  }

  const context = new AudioContext();
  const source = context.createMediaElementSource(media);
  const localGain = context.createGain();
  const stationGain = context.createGain();
  const streamDestination = context.createMediaStreamDestination();
  const monitor = document.createElement('audio');
  monitor.autoplay = true;
  monitor.setAttribute('aria-hidden', 'true');
  monitor.style.display = 'none';
  monitor.srcObject = streamDestination.stream;
  document.documentElement.appendChild(monitor);

  source.connect(localGain).connect(context.destination);
  source.connect(stationGain).connect(streamDestination);
  localGain.gain.value = 1;
  stationGain.gain.value = Math.max(0.001, Math.min(1, Number(stationAudioSettings.monitorVolume) || 0.02));

  try {
    await monitor.setSinkId(device.deviceId);
    await context.resume();
    await monitor.play();
    stationMirror = { media, context, source, localGain, stationGain, streamDestination, monitor, deviceLabel: device.label };
    console.log(`[station-audio] Реальный поток дублируется на: ${device.label}`);
  } catch (error) {
    console.warn('[station-audio] Не удалось подключить Bluetooth-выход:', error.message || error);
    monitor.remove();
    try { await context.close(); } catch {}
    stationMirror = { warningShown: true };
  }
}

function disconnectStationMirror() {
  if (!stationMirror) return;
  stationMirror.monitor?.pause();
  stationMirror.monitor?.remove();
  stationMirror.monitor = null;
  // The local branch and MediaElementSource remain active for the current
  // media element; only the Bluetooth monitor is disconnected.
}

async function applyStationAudioSettings(settings) {
  stationAudioSettings = settings || null;
  if (!stationAudioSettings?.enabled) {
    disconnectStationMirror();
    return;
  }
  if (stationMirror?.stationGain) {
    stationMirror.stationGain.gain.value = Math.max(0.001, Math.min(1, Number(stationAudioSettings.monitorVolume) || 0.02));
  }
  await connectStationMirror();
}

ipcRenderer.on('tunerift:station-audio-settings', (_event, settings) => {
  applyStationAudioSettings(settings).catch((error) => console.warn('[station-audio]', error.message || error));
});
ipcRenderer.invoke('settings:get').then((settings) => {
  return applyStationAudioSettings({
    enabled: Boolean(settings?.stationAudioEnabled || settings?.stationAutoConnect),
    deviceHint: settings?.stationDeviceHint,
    monitorVolume: settings?.stationMonitorVolume
  });
}).catch(() => {});
setInterval(() => connectStationMirror().catch(() => {}), 2500);

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'tunerift:ynison-diagnostic') {
    ipcRenderer.send('tunerift:ynison-diagnostic', {
      event: data.event,
      durationMs: data.durationMs,
      positionMs: data.positionMs
    });
    return;
  }

  if (data.type !== 'tunerift:ynison-timing') return;

  const durationMs = Number(data.durationMs);
  const positionMs = Number(data.positionMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  if (!Number.isFinite(positionMs) || positionMs < 0) return;

  latestYnisonTiming = {
    durationMs: Math.round(durationMs),
    positionMs: Math.round(positionMs),
    paused: Boolean(data.paused),
    updatedAt: Date.now()
  };

  if (!reportedYnisonTiming) {
    reportedYnisonTiming = true;
    ipcRenderer.send('tunerift:ynison-diagnostic', {
      event: 'timing-forwarded',
      durationMs: latestYnisonTiming.durationMs,
      positionMs: latestYnisonTiming.positionMs
    });
  }

  // Важно: Ynison может прийти между двумя опросами MediaSession.
  // Немедленно пересылаем уже известные метаданные трека с новым таймлайном.
  if (latestNowPlaying) {
    ipcRenderer.send('nowplaying:update', {
      ...latestNowPlaying,
      durationMs: latestYnisonTiming.durationMs,
      positionMs: latestYnisonTiming.positionMs,
      isPlaying: !latestYnisonTiming.paused
    });
  }
});

function getPlaybackTiming() {
  // Расширение запускается в MAIN world до скриптов сайта и получает Ynison.
  if (latestYnisonTiming && Date.now() - latestYnisonTiming.updatedAt < 15000) {
    return latestYnisonTiming;
  }

  const mediaElements = [...document.querySelectorAll('audio, video')];
  const media = mediaElements.find(element => !element.paused && Number.isFinite(element.duration) && element.duration > 0)
    || mediaElements.find(element => Number.isFinite(element.duration) && element.duration > 0);
  if (media) {
    return {
      durationMs: Math.round(media.duration * 1000),
      positionMs: Math.round(media.currentTime * 1000)
    };
  }

  // Резервный источник: видимый ползунок времени веб-плеера.
  const timeRange = [...document.querySelectorAll('input[type="range"]')].find((element) => {
    const label = (element.getAttribute('aria-label') || '').toLowerCase();
    const max = Number(element.max);
    return Number.isFinite(max) && max > 1 && (label.includes('time') || label.includes('врем'));
  });
  if (!timeRange) return null;

  const durationSeconds = Number(timeRange.max);
  const positionSeconds = Number(timeRange.value);
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(positionSeconds)) return null;

  return {
    durationMs: Math.round(durationSeconds * 1000),
    positionMs: Math.round(positionSeconds * 1000)
  };
}

// MediaSession даёт название, исполнителя и обложку. Точный таймлайн Ynison
// добавляется к этим данным уже в главном процессе Electron.
function pollNowPlaying() {
  try {
    const ms = navigator.mediaSession;
    const meta = ms && ms.metadata;
    if (!meta) {
      ipcRenderer.send('nowplaying:update', null);
      return;
    }

    const timing = getPlaybackTiming();
    const isPlaying = timing?.paused === undefined ? ms.playbackState === 'playing' : !timing.paused;
    const artwork = Array.isArray(meta.artwork) && meta.artwork.length
      ? meta.artwork.reduce((largest, item) => {
          const size = Number(item.sizes?.split('x')[0]) || 0;
          const largestSize = Number(largest?.sizes?.split('x')[0]) || 0;
          return size >= largestSize ? item : largest;
        }, null)
      : null;
    const idMatch = location.href.match(/\/track\/(\d+)/);

    latestNowPlaying = {
      title: meta.title || '',
      artists: meta.artist || '',
      coverUrl: artwork?.src || null,
      id: idMatch ? idMatch[1] : null,
      durationMs: timing?.durationMs || null,
      positionMs: timing?.positionMs || null,
      isPlaying
    };
    ipcRenderer.send('nowplaying:update', latestNowPlaying);
  } catch {
    // MediaSession может быть недоступен на некоторых страницах.
  }
}

setInterval(pollNowPlaying, 2000);
window.addEventListener('DOMContentLoaded', pollNowPlaying);

// Мост между аддоном ui-tweaks (кнопка «Настройки приложения») и Electron.
window.addEventListener('message', (event) => {
  const replyTarget = event.source && typeof event.source.postMessage === 'function' ? event.source : window;
  if (event.data && event.data.type === 'ymelectron:open-settings') {
    ipcRenderer.send('open-settings-window');
    return;
  }

  if (event.data && event.data.type === 'tunerift:mod-settings:get') {
    Promise.all([
      ipcRenderer.invoke('settings:get'),
      ipcRenderer.invoke('addons:list')
    ]).then(([settings, addons]) => {
      replyTarget.postMessage({
        type: 'tunerift:mod-settings:state',
        settings,
        addons
      }, '*');
    }).catch((error) => {
      replyTarget.postMessage({
        type: 'tunerift:mod-settings:error',
        message: error?.message || String(error)
      }, '*');
    });
    return;
  }

  if (event.data && event.data.type === 'tunerift:mod-settings:set') {
    const { key, value } = event.data;
    const request = key === 'discordEnabled' || key === 'newDesign'
      ? ipcRenderer.invoke('settings:set', key, Boolean(value))
      : key === 'addon'
        ? ipcRenderer.invoke('addons:toggle', event.data.id, Boolean(value))
        : Promise.reject(new Error('Unknown TuneRift setting'));

    request.then(() => {
      replyTarget.postMessage({ type: 'tunerift:mod-settings:saved', key, id: event.data.id, value }, '*');
    }).catch((error) => {
      replyTarget.postMessage({
        type: 'tunerift:mod-settings:error',
        message: error?.message || String(error)
      }, '*');
    });
  }
});
