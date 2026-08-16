// Принудительно возвращает классический интерфейс Яндекс Музыки.
// Перехватывает как уже существующий, так и поздно созданный __STATE_PATCHES__.
(() => {
  'use strict';
  const MARK = '__tuneRiftOldDesignPush__';
  const PROPERTY_MARK = '__tuneRiftOldDesignProperty__';

  function overrideFlag(patchArray) {
    if (!Array.isArray(patchArray)) return;
    for (const op of patchArray) {
      if (!op || op.path !== '/experiments/experiments' || !op.value) continue;
      const exps = op.value;
      if (exps.WebNextNewWaveTab) {
        exps.WebNextNewWaveTab.group = 'default';
        exps.WebNextNewWaveTab.value = { title: 'default' };
      }
    }
  }

  function wrapPatches(patches) {
    if (!Array.isArray(patches)) return patches;
    patches.forEach(overrideFlag);
    if (patches.push?.[MARK]) return patches;
    const originalPush = patches.push;
    const wrappedPush = function (...args) {
      args.forEach(overrideFlag);
      return originalPush.apply(this, args);
    };
    wrappedPush[MARK] = true;
    patches.push = wrappedPush;
    return patches;
  }

  function install() {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, '__STATE_PATCHES__');
      if (descriptor?.set && descriptor.set[PROPERTY_MARK]) return;
      let value = Array.isArray(window.__STATE_PATCHES__)
        ? wrapPatches(window.__STATE_PATCHES__)
        : window.__STATE_PATCHES__;

      const setter = (next) => {
        value = Array.isArray(next) ? wrapPatches(next) : next;
      };
      setter[PROPERTY_MARK] = true;
      Object.defineProperty(window, '__STATE_PATCHES__', {
        configurable: true,
        enumerable: true,
        get: () => value,
        set: setter
      });
      if (Array.isArray(value)) wrapPatches(value);
    } catch {
      // Страница может временно сделать свойство non-configurable.
      // Следующая проверка попробует установить перехват повторно.
    }
  }

  install();
  const timer = setInterval(install, 500);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  console.log('[old-design-builtin] принудительный старый дизайн активен');
})();
