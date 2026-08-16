# Как добавить расширение «Старый дизайн Яндекс Музыки»

У меня нет доступа к Chrome Web Store из песочницы, поэтому расширение нужно
экспортировать самому — это займёт минуту.

## Способ 1 — вытащить из установленного Chrome (проще всего)
1. Открой в Chrome: `chrome://extensions`
2. Включи «Режим разработчика» (переключатель справа сверху)
3. Найди «Старый дизайн Яндекс Музыки», посмотри его **ID**
   (`dkhmglklcjepejahpenopclbciilmmdm`)
4. Открой папку профиля Chrome:
   - Windows: `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions\<ID>`
   - macOS: `~/Library/Application Support/Google/Chrome/Default/Extensions/<ID>`
   - Linux: `~/.config/google-chrome/Default/Extensions/<ID>`
5. Внутри будет папка с версией (например `1.4.2_0`) — это и есть unpacked-расширение.
6. Скопируй эту папку сюда, в `extensions/`, и переименуй во что-то понятное,
   например `extensions/old-ym-design/` (внутри обязательно должен остаться `manifest.json`).

## Способ 2 — через crx-extractor
Если Chrome не под рукой — можно скачать `.crx` любым онлайн CRX-даунлоадером
по ID `dkhmglklcjepejahpenopclbciilmmdm` и распаковать (`.crx` — обычный zip
с 4-байтным заголовком, есть готовые распаковщики, например `crx3-utils` в npm).

## Важно
- Electron поддерживает Manifest V2 «из коробки». Если у расширения
  **Manifest V3**, часть API (особенно `chrome.scripting`, service workers)
  может работать не полностью — это ограничение самого Electron, а не нашего кода.
- Приложение подхватывает **любую** папку с `manifest.json` внутри `extensions/`,
  так что сюда же можно добавить и другие расширения при желании.
- Отключить загрузку расширений можно в Настройках приложения
  («Загружать Chrome-расширения»).
