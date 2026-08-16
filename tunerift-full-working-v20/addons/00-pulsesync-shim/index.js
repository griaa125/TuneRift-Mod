// ЭКСПЕРИМЕНТАЛЬНО: минимальный шим window.pulsesyncApi для сторонних PulseSync-аддонов.
//
// v2: вместо угадывания внутреннего имени объекта состояния плеера (window.sonataState
// не подтвердился) — достаём текущий трек прямо из React-дерева плеербара по
// стабильному data-test-id="PLAYERBAR_DESKTOP", тем же способом, каким сам
// FckCensor достаёт id трека из строк списка (через __reactFiber-проп).
(function () {
  if (window.pulsesyncApi) {
    console.log('[pulsesync-shim] window.pulsesyncApi уже существует — шим не нужен');
    return;
  }

  function looksLikeTrack(obj) {
    return obj && typeof obj === 'object' && obj.id && obj.title && (obj.coverUri || obj.artists);
  }

  function searchPropsForTrack(obj, depth, seen) {
    if (!obj || depth > 2 || typeof obj !== 'object') return null;
    if (seen.has(obj)) return null;
    seen.add(obj);
    if (looksLikeTrack(obj)) return obj;
    for (const key of Object.keys(obj)) {
      if (key === 'children' || key.startsWith('_owner') || key.startsWith('__')) continue;
      let val;
      try { val = obj[key]; } catch (e) { continue; }
      if (val && typeof val === 'object') {
        const found = searchPropsForTrack(val, depth + 1, seen);
        if (found) return found;
      }
    }
    return null;
  }

  function findTrackViaFiber(root) {
    const key = Object.keys(root).find(k => k.startsWith('__reactFiber'));
    if (!key) return null;
    let fiber = root[key];
    const seen = new Set();
    // Ограничиваем подъём по дереву — глубже вряд ли остался плеербар,
    // а вот шанс зацепить общие провайдеры состояния (и их MobX-стор) растёт.
    for (let i = 0; i < 12 && fiber; i++) {
      if (fiber.memoizedProps) {
        const found = searchPropsForTrack(fiber.memoizedProps, 0, seen);
        if (found) return found;
      }
      fiber = fiber.return;
    }
    return null;
  }

  function getPlayerbar() {
    // На актуальной версии сайта плеер снизу не имеет data-test-id, только класс
    // PlayerBarDesktopWithBackgroundProgressBar_player__<хэш>
    return document.querySelector('[class*="PlayerBarDesktopWithBackgroundProgressBar_player__"], [data-test-id="PLAYERBAR_DESKTOP"]');
  }

  // === getSettings(addonName) ===
  // Многим сторонним PulseSync-аддонам достаточно, чтобы этот метод просто
  // не падал и возвращал что-то с getCurrent()/onChange() — свои дефолты они
  // подставляют сами. Хранилище — localStorage страницы (переживает перезапуск
  // приложения в рамках партиции persist:ymelectron), без похода в main-процесс.
  const settingsListeners = new Map(); // addonName -> Set<callback>

  function readStoredSettings(addonName) {
    try {
      const raw = localStorage.getItem('ymelectron:settings:' + addonName);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function writeStoredSettings(addonName, settings) {
    try {
      localStorage.setItem('ymelectron:settings:' + addonName, JSON.stringify(settings));
    } catch (e) {}
    const listeners = settingsListeners.get(addonName);
    if (listeners) listeners.forEach(cb => { try { cb(settings); } catch (e) {} });
  }

  function getSettings(addonName) {
    return {
      getCurrent: () => readStoredSettings(addonName),
      onChange: (cb) => {
        if (!settingsListeners.has(addonName)) settingsListeners.set(addonName, new Set());
        settingsListeners.get(addonName).add(cb);
        return () => settingsListeners.get(addonName)?.delete(cb);
      },
      // Не входит в стандартный API PulseSync, но пригодится, если позже
      // появится своя UI-панель настроек:
      set: (patch) => writeStoredSettings(addonName, { ...readStoredSettings(addonName), ...patch })
    };
  }

  // === isPlaying() ===
  // Яндекс Музыка использует настоящий <audio>/<video> элемент под капотом
  // (видно по стандартным событиям play/pause/timeupdate в консоли) — берём
  // состояние прямо оттуда, никаких внутренних объектов Яндекса дёргать не нужно.
  function isPlaying() {
    const media = document.querySelector('audio, video');
    if (!media) return false;
    return !media.paused && !media.ended;
  }

  window.pulsesyncApi = {
    getCurrentTrack() {
      try {
        const bar = getPlayerbar();
        if (!bar) return null;
        const track = findTrackViaFiber(bar);
        if (!track) return null;
        let coverUri = track.coverUri || null;
        if (coverUri && !coverUri.startsWith('http')) coverUri = 'https://' + coverUri.replace('%%', '400x400');
        return { id: track.id, title: track.title, artists: track.artists, coverUri };
      } catch (e) {
        console.error('[pulsesync-shim] getCurrentTrack() не сработал:', e.message);
        return null;
      }
    },
    getSettings,
    isPlaying,
    _waitForPlayer(cb) {
      let attempts = 0;
      function tryInit() {
        attempts++;
        const bar = getPlayerbar();
        if (bar) {
          const fakePlayer = {
            state: {
              queueState: {
                currentEntity: {
                  // Реактивность реализована через MutationObserver на сам плеербар —
                  // вызываем callback при любом визуальном изменении (смена трека меняет DOM).
                  onChange(fn) {
                    const observer = new MutationObserver(() => fn());
                    observer.observe(bar, { childList: true, subtree: true, characterData: true });
                  }
                }
              }
            }
          };
          cb(fakePlayer);
          return true;
        }
        if (attempts > 40) {
          console.error('[pulsesync-shim] [data-test-id="PLAYERBAR_DESKTOP"] так и не появился на странице');
          return true;
        }
        return false;
      }
      if (!tryInit()) {
        const iv = setInterval(() => { if (tryInit()) clearInterval(iv); }, 500);
      }
    }
  };

  console.log('[pulsesync-shim] window.pulsesyncApi v3 создан (+ getSettings, isPlaying)');
})();
