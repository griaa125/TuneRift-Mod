const fs = require('fs');
const path = require('path');

// Формат аддона (как в PulseSync):
// addons/<id>/addon.json  { "id": "...", "name": "...", "description": "...", "enabledByDefault": true, "script": "index.js", "style": "style.css" }
// addons/<id>/index.js    — выполняется в MAIN world страницы (имеет доступ к window/webpack-модулям сайта)
// addons/<id>/style.css   — опционально, вставляется через insertCSS

function normalizeManifest(raw, dirName) {
  // Наш формат: addon.json { id, name, description, enabledByDefault, script, style }
  // Формат PulseSync: metadata.json { id, name, description, script, css, ... }
  if (raw.script === undefined && raw.css === undefined) return null; // не похоже ни на один формат
  return {
    id: raw.id || dirName,
    name: raw.name || dirName,
    description: raw.description || '',
    enabledByDefault: raw.enabledByDefault !== undefined ? !!raw.enabledByDefault : false, // pulsesync-аддоны по умолчанию выключены — включаются осознанно
    script: raw.script || null,
    style: raw.style || raw.css || null
  };
}

function readManifests(addonDir) {
  if (!fs.existsSync(addonDir)) { console.log('[addons] Папка не найдена:', addonDir); return []; }
  const dirs = fs.readdirSync(addonDir).sort(); // сортировка — чтобы папки с префиксом "00-" грузились первыми (см. 00-pulsesync-shim)
  console.log('[addons] Содержимое addons/:', dirs);
  const result = [];
  for (const d of dirs) {
    const p = path.join(addonDir, d);
    try {
      if (!fs.statSync(p).isDirectory()) continue;
      const ownPath = path.join(p, 'addon.json');
      const pulsesyncPath = path.join(p, 'metadata.json');
      let raw, manifestPath;
      if (fs.existsSync(ownPath)) { manifestPath = ownPath; raw = JSON.parse(fs.readFileSync(ownPath, 'utf-8')); }
      else if (fs.existsSync(pulsesyncPath)) { manifestPath = pulsesyncPath; raw = JSON.parse(fs.readFileSync(pulsesyncPath, 'utf-8')); }
      else continue;

      const manifest = normalizeManifest(raw, d);
      if (!manifest) { console.error(`[addons] ${d}: манифест не похож ни на наш формат, ни на PulseSync — пропускаю`); continue; }
      manifest._dir = p;
      result.push(manifest);
    } catch (err) {
      console.error(`[addons] ${d}: НЕ ЧИТАЕТСЯ манифест (${err.message}) — этот аддон пропущен, остальные загрузятся нормально`);
    }
  }
  console.log('[addons] Манифесты найдены:', result.map(m => m.id));
  return result;
}

function getAddonManifests(addonDir, storedState) {
  return readManifests(addonDir).map(m => ({
    id: m.id,
    name: m.name,
    description: m.description || '',
    enabled: storedState.hasOwnProperty(m.id) ? storedState[m.id] : !!m.enabledByDefault
  }));
}

function injectAddon(webContents, addonId, addonDir, storedState = {}) {
  const manifest = readManifests(addonDir).find(m => m.id === addonId);
  if (!manifest) {
    console.warn(`[addons] ${addonId}: манифест не найден`);
    return;
  }
  const enabled = storedState.hasOwnProperty(manifest.id) ? storedState[manifest.id] : !!manifest.enabledByDefault;
  console.log(`[addons] ${manifest.id}: frame injection enabled=${enabled}`);
  if (!enabled) return;
  try {
    if (manifest.style) {
      const cssPath = path.join(manifest._dir, manifest.style);
      if (fs.existsSync(cssPath)) webContents.insertCSS(fs.readFileSync(cssPath, 'utf-8')).catch(err => console.error(`[addons] ${manifest.id}: frame CSS error`, err));
    }
    if (manifest.script) {
      const jsPath = path.join(manifest._dir, manifest.script);
      if (fs.existsSync(jsPath)) {
        webContents.executeJavaScript(fs.readFileSync(jsPath, 'utf-8'), true)
          .then(() => console.log(`[addons] ${manifest.id}: frame JS выполнен успешно`))
          .catch(err => console.error(`[addons] ${manifest.id}: frame JS error`, err.message || err));
      }
    }
  } catch (err) {
    console.error(`[addons] ${manifest.id}: frame injection exception`, err.message || err);
  }
}

function injectEnabledAddons(webContents, storedState, addonDir) {
  const manifests = readManifests(addonDir);
  for (const m of manifests) {
    try {
      const enabled = storedState.hasOwnProperty(m.id) ? storedState[m.id] : !!m.enabledByDefault;
      console.log(`[addons] ${m.id}: enabled=${enabled} (stored=${storedState.hasOwnProperty(m.id)}, default=${!!m.enabledByDefault})`);
      if (!enabled) continue;

      if (m.style) {
        const cssPath = path.join(m._dir, m.style);
        if (fs.existsSync(cssPath)) {
          webContents.insertCSS(fs.readFileSync(cssPath, 'utf-8'))
            .then(() => console.log(`[addons] ${m.id}: CSS вставлен`))
            .catch(err => console.error(`[addons] ${m.id}: ошибка вставки CSS`, err));
        }
      }
      if (m.script) {
        const jsPath = path.join(m._dir, m.script);
        if (fs.existsSync(jsPath)) {
          // MAIN world выполнения (не isolated) — как у PulseSync-аддонов,
          // нужен для патчей webpack-модулей самого сайта.
          webContents.executeJavaScript(fs.readFileSync(jsPath, 'utf-8'), true)
            .then(() => console.log(`[addons] ${m.id}: JS выполнен успешно`))
            .catch(err => {
              console.error(`[addons] ${m.id}: ОШИБКА выполнения JS ->`, err.message || err);
            });
        } else {
          console.error(`[addons] ${m.id}: файл скрипта не найден:`, jsPath);
        }
      }
    } catch (err) {
      console.error(`[addons] ${m.id || '???'}: неожиданная ошибка, пропускаю этот аддон:`, err.message || err);
    }
  }
}

module.exports = { getAddonManifests, injectEnabledAddons, injectAddon };
