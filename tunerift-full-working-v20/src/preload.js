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

let latestYnisonTiming = null;
let latestNowPlaying = null;

let reportedYnisonTiming = false;

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
