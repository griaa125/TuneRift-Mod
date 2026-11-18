// Обновлённый переключатель старого дизайна Яндекс Музыки.
// Взято только исправление совместимости с новым API экспериментов из версии
// 1.5 расширения Web Store. Скрипты донатов, popup и авторская поддержка сюда
// намеренно не включаются.
(() => {
  'use strict';
  const FLAG = 'WebNextNewWaveTab';
  const PUSH_MARK = '__tuneRiftOldDesignPushV2__';
  const PROPERTY_MARK = '__tuneRiftOldDesignPropertyV2__';

  function overrideExperiments(experiments) {
    const flag = experiments?.[FLAG];
    if (!flag || typeof flag !== 'object') return;
    flag.group = 'default';
    flag.value = { title: 'default' };
  }

  function overrideFlag(patchArray) {
    if (!Array.isArray(patchArray)) return;
    for (const op of patchArray) {
      if (op?.path === '/experiments/experiments' && op.value) overrideExperiments(op.value);
    }
  }

  function wrapPatches(patches) {
    if (!Array.isArray(patches)) return patches;
    patches.forEach(overrideFlag);
    if (patches.push?.[PUSH_MARK]) return patches;
    const originalPush = patches.push;
    const wrappedPush = function (...args) {
      args.forEach(overrideFlag);
      return originalPush.apply(this, args);
    };
    wrappedPush[PUSH_MARK] = true;
    patches.push = wrappedPush;
    return patches;
  }

  function installStatePatchHook() {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, '__STATE_PATCHES__');
      if (descriptor?.set?.[PROPERTY_MARK]) return;
      let value = Array.isArray(window.__STATE_PATCHES__)
        ? wrapPatches(window.__STATE_PATCHES__)
        : window.__STATE_PATCHES__;
      const setter = (next) => { value = Array.isArray(next) ? wrapPatches(next) : next; };
      setter[PROPERTY_MARK] = true;
      Object.defineProperty(window, '__STATE_PATCHES__', {
        configurable: true, enumerable: true, get: () => value, set: setter
      });
      wrapPatches(value);
    } catch {
      // Страница может временно сделать свойство non-configurable.
    }
  }

  // В новых версиях music-spa эксперименты приходят через API, а не только
  // через SSR-патчи. Меняем данные после json(), сохраняя исходный Response.
  const originalJson = Response.prototype.json;
  if (!originalJson.__tuneRiftOldDesignResponseV2__) {
    const patchedJson = function (...args) {
      const result = originalJson.apply(this, args);
      let url;
      try { url = new URL(this.url); } catch { return result; }
      if (!/^https?:$/.test(url.protocol)
        || !/^(?:api\.)?music\.yandex\.(?:ru|by|kz|uz|com|net)$/.test(url.hostname)
        || url.pathname !== '/account/experiments/details') return result;
      return result.then((data) => {
        overrideExperiments(data);
        overrideExperiments(data?.result);
        return data;
      });
    };
    patchedJson.__tuneRiftOldDesignResponseV2__ = true;
    Response.prototype.json = patchedJson;
  }

  installStatePatchHook();
  const timer = setInterval(installStatePatchHook, 500);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  console.log('[old-design-builtin] обновлённый старый дизайн активен');
})();
