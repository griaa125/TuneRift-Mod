# Иконка приложения

Проект использует следующие файлы:

| Файл | Назначение |
|---|---|
| `build/ym_logo.png` | Иконка главного окна и окна настроек; Windows/Linux. |
| `build/ym_logo.icns` | Нативный значок Dock и собранного приложения macOS. |

При `npm start` на macOS запускается `Electron.app` из `node_modules`. Скрипт `scripts/set-macos-dev-icon.js` выполняется автоматически перед каждым запуском и заменяет его внутренний ресурс `electron.icns` на `build/ym_logo.icns`. Поэтому Dock использует логотип и после следующего `npm install`, который обычно восстанавливает стандартный ресурс Electron.

Для ручной разовой замены скопируй `build/ym_logo.icns` в:

```text
node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns
```

Обычный запуск `npm start` не отменяет ручную замену. Она будет сброшена только при переустановке или обновлении зависимости `electron`.
