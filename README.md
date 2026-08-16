# Yandex Music — Electron

Обёртка над music.yandex.ru с поддержкой:
- Chrome-расширений (unpacked, MV2 полностью, MV3 частично — ограничение Electron)
- Своих «PulseSync-style» аддонов (JS/CSS, инжектятся в MAIN world страницы), с тумблерами в настройках
- Discord Rich Presence (трек/артист/обложка/статус play-pause)

## Установка

```bash
npm install
npm start
```

## Discord Rich Presence
1. Зайди на https://discord.com/developers/applications → New Application
2. Скопируй Client ID
3. Вставь его в `src/discordRPC.js` (константа `CLIENT_ID`) —
   либо запусти приложение с переменной окружения:
   ```bash
   DISCORD_CLIENT_ID=твой_id npm start
   ```
4. (Опционально) в разделе Rich Presence → Art Assets загрузи картинки
   с ключами `ym_logo`, `play`, `pause` — они используются как иконки статуса.

Данные о треке приложение берёт из MediaSession API самой страницы —
Яндекс Музыка его уже заполняет для системных медиа-клавиш, так что
парсить DOM не пришлось.

## Расширение «Старый дизайн Яндекс Музыки»
См. `extensions/README.md` — там пошагово, как экспортировать его из
установленного Chrome в unpacked-папку.

## Свои PulseSync-аддоны
Кидай папки в `addons/`, формат — см. `addons/example-addon/`:
```
addons/
  my-addon/
    addon.json   { id, name, description, enabledByDefault, script, style }
    index.js     — выполняется в контексте страницы (MAIN world)
    style.css    — опционально
```
Включение/выключение — через окно «Настройки» в приложении, состояние
хранится через electron-store и переживает перезапуск.

## Сборка установщика
```bash
npm run build
```
electron-builder соберёт dmg/nsis/AppImage в зависимости от платформы.
