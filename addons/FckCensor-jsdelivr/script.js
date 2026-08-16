(function() {
    "use strict"
    const ADDON_NAME = "FckCensor";
    function log(...args) {
        console.debug("[" + ADDON_NAME + "]", ...args);
    }

    /* == получение метода require из webpack == */
    const webpackGlobal = window.webpackChunk_N_E;
    let appRequire = null;

    webpackGlobal.push([[Symbol("requireGetter__" + ADDON_NAME)],
        {},
        (internalRequire) => {
            appRequire = internalRequire;
        }
    ]);
    webpackGlobal.pop();

    if (!appRequire) {
        console.error("Failed to get appRequire func");
        return;
    }


    // получение DI модуля (оно хранит все синглтоны необходимые для работы аддона)
    function findModule(...requiredStrings) {
        for (const id in appRequire.m) {
            try {
                const mod = appRequire(id);
                const moduleStr = Object.keys(mod);
                if (requiredStrings.every(str => moduleStr.includes(str))) {
                    return mod;
                }
            } catch(e) {
                log(`Ошибка при поиске модуля ${id}`, e);
            }
        }
        return null;
    }

    const diModule = findModule("Dt", "P9", "Gr", "do");
    if (!diModule?.Dt) {
        console.error("Failed to find DI module. Wait for addon update!");
        return;
    }

    
    const di = diModule.Dt;
    const originalDiGet = di.prototype.get;

    // хук получения DI
    let hooked = false;
    di.prototype.get = function(_) {
        const result = originalDiGet.apply(this, arguments);

        if (!hooked) {
            const gfir = this.shared.get("GetFileInfoResource");

            // На актуальной версии сайта нужный метод называется getFileInfo
            // (раньше был getLocalFileDownloadInfo), и первый попавшийся объект
            // может быть заглушкой без методов — ждём полноценный экземпляр.
            if (gfir && typeof gfir.getFileInfo === 'function') {
                hooked = true;
                di.prototype.get = originalDiGet;
                hookMethods(gfir);
            }
        }
        
        return result;
    };

    let _notificationComponentsCache = null;
    function getNotificationComponents() {
        if (_notificationComponentsCache) return _notificationComponentsCache;

        const notificationManager = findModule("Notification", "notification", "dismiss")
        const React = findModule("createElement", "cacheSignal", "createContext", "createRef", "forwardRef")
        const NotificationComponent = findModule("$W", "NX", "fJ", "cp", "hT", "OM", "DZ")
        const Typography = findModule("Caption", "Heading")
        const PaperComponent = findModule("Paper").Paper
        const styles = findModule("message", "cover", "image", "text")

        _notificationComponentsCache = {
            notificationManager: notificationManager,
            React: React,
            NotificationComponent: NotificationComponent,
            Typography: Typography,
            PaperComponent: PaperComponent,
            styles: styles
        }
        return _notificationComponentsCache;
    }

    function postNotification(caption, image = null) {
        const { notificationManager, React, NotificationComponent, Typography, PaperComponent, styles } = getNotificationComponents();
        const children = [];

        if (image) {
          const img = React.createElement(NotificationComponent.BW, {
            className: styles.image,
            src: image,
            alt: "cover",
            size: 100,
            fit: "cover",
            withAvatarReplace: true
          });

          const paper = React.createElement(PaperComponent, {
            className: styles.cover,
            radius: "s",
          }, img);

          children.push(paper);
        }

        const text = React.createElement(Typography.Caption, {
          className: styles.text,
          variant: "div",
          type: "controls",
          size: "m",
          "aria-hidden": true
        }, caption);

        children.push(text);

        const content = React.createElement("div", {
          className: styles.message
        }, ...children);

        const ctr = React.createElement(NotificationComponent.$W, { 
          message: content 
        });

        notificationManager.notification({
          message: ctr,
          options: { autoClose: 2e3, closeOnClick: true, pauseOnHover: true, draggable: false, single: true, containerId: "INFO"},
        });
    }

    function postNotificationWithCover(caption, trackId) {
        const currentTrack = pulsesyncApi.getCurrentTrack();
        const coverUri = currentTrack && currentTrack.id == trackId ? currentTrack.coverUri : null;
        postNotification(caption, coverUri);
    }

    // === диагностика: инструментируем MediaSource/SourceBuffer/<audio>, чтобы
    // видеть, ЧТО именно происходит с подменным треком в момент попытки играть,
    // а не гадать. Ставится один раз, не мешает обычным (незаменённым) трекам.
    // Ищи в консоли префикс [FckCensor][diag].
    (function installMediaDiagnostics() {
        if (window.__fckcensorMediaDiagInstalled) return;
        window.__fckcensorMediaDiagInstalled = true;
        const dlog = (...args) => console.debug("[FckCensor][diag]", ...args);

        if (window.MediaSource && MediaSource.prototype.addSourceBuffer) {
            const origAdd = MediaSource.prototype.addSourceBuffer;
            MediaSource.prototype.addSourceBuffer = function (mimeCodec) {
                dlog("MediaSource.addSourceBuffer(", mimeCodec, ")");
                try {
                    const sb = origAdd.call(this, mimeCodec);
                    const origAppend = sb.appendBuffer;
                    sb.appendBuffer = function (chunk) {
                        try {
                            const len = chunk && (chunk.byteLength || (chunk.buffer && chunk.buffer.byteLength));
                            dlog("SourceBuffer.appendBuffer(", len, "bytes ) for mime", mimeCodec);
                        } catch (e) {}
                        return origAppend.apply(this, arguments);
                    };
                    sb.addEventListener("error", (ev) => dlog("SourceBuffer error event for mime", mimeCodec, ev));
                    return sb;
                } catch (e) {
                    dlog("addSourceBuffer БРОСИЛ ИСКЛЮЧЕНИЕ для mime", mimeCodec, "->", e.name, e.message);
                    throw e;
                }
            };
        }

        // Ловим 'error' на любом <audio>/<video>, который появляется на странице —
        // именно там окажется MediaError с кодом/сообщением, если плеер не смог
        // задекодировать то, что мы подсунули.
        document.addEventListener("error", (ev) => {
            const t = ev.target;
            if (t && (t.tagName === "AUDIO" || t.tagName === "VIDEO")) {
                const err = t.error;
                dlog("media element error:", err && { code: err.code, message: err.message }, "currentSrc:", t.currentSrc);
            }
        }, true);
    })();

    // === приведение скачанного трека к гарантированно проигрываемому виду ===
    // Предыдущие попытки (голый URL, blob с угаданным MIME, WAV-перекодировка,
    // File(.aac), data:-URL) трогали только downloadInfo.url/urls. Но у getFileInfo
    // (в отличие от старого getLocalFileDownloadInfo) downloadInfo содержит ещё
    // codec/container/bitrate и т.п. от ОРИГИНАЛЬНОГО (незаменённого) AAC-ответа.
    // Если плеер строит MSE SourceBuffer по этим полям, а не по факту байтов —
    // он создаст буфер под aac/mp4 и молча не сможет прочитать в нём MP3.
    // Здесь: 1) скачиваем и определяем реальный формат по сигнатуре байт,
    // 2) отдаём Blob (не data:/File с именем - это раньше путало роутер сайта),
    // 3) вдобавок патчим любые codec/container-подобные поля в downloadInfo,
    // чтобы они указывали на реальный формат файла, а не на исходный AAC.
    const blobUrlCache = new Map(); // trackId -> { url, format }

    function detectAudioFormat(buffer) {
        const bytes = new Uint8Array(buffer.slice(0, 12));
        // MP3: 'ID3' тег или frame sync 0xFFEx/0xFFFx
        if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
            return { mime: "audio/mpeg", codec: "mp3", container: "mp3" };
        }
        if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) {
            return { mime: "audio/mpeg", codec: "mp3", container: "mp3" };
        }
        // M4A/AAC-в-MP4: 'ftyp' на 4-м байте
        if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
            return { mime: "audio/mp4", codec: "aac", container: "mp4" };
        }
        // FLAC
        if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) {
            return { mime: "audio/flac", codec: "flac", container: "flac" };
        }
        return { mime: "audio/mpeg", codec: "mp3", container: "mp3" }; // разумный дефолт для этого репозитория подмен
    }

    async function toPlayableBlobUrl(trackId, url) {
        if (blobUrlCache.has(trackId)) return blobUrlCache.get(trackId);

        const response = await fetch(url);
        if (!response.ok) throw new Error("Не удалось скачать подменный трек, статус " + response.status);
        const buffer = await response.arrayBuffer();
        const format = detectAudioFormat(buffer);

        const blob = new Blob([buffer], { type: format.mime });
        const blobUrl = URL.createObjectURL(blob);

        log("Подменный трек " + trackId + " определён как " + format.mime + " (" + Math.round(buffer.byteLength / 1024) + " КБ), blob-url создан");
        const result = { url: blobUrl, format: format };
        blobUrlCache.set(trackId, result);
        return result;
    }

    // Ищет в объекте (максимум на 2 уровня вглубь) поля, похожие на указание
    // кодека/контейнера исходного (незаменённого) трека, и переписывает их под
    // реальный формат подменного файла. Имена полей у Яндекса не документированы
    // публично, поэтому ищем эвристически по значению, а не по конкретному ключу.
    function patchCodecFields(obj, format, depth, seen) {
        depth = depth || 0;
        seen = seen || new Set();
        if (!obj || typeof obj !== "object" || depth > 2 || seen.has(obj)) return;
        seen.add(obj);
        for (const key of Object.keys(obj)) {
            let val;
            try { val = obj[key]; } catch (e) { continue; }
            if (typeof val === "string" && /aac|mp4a|m4a|flac|alac/i.test(val) && !/url/i.test(key)) {
                log("Патчу поле downloadInfo." + key + ": \"" + val + "\" -> \"" + format.codec + "\"");
                obj[key] = format.codec;
            } else if (typeof val === "object" && val !== null) {
                patchCodecFields(val, format, depth + 1, seen);
            }
        }
    }

    // основной код аддона, выполняется после инициализации DI
    function hookMethods(gfir) {
        // Актуальная версия API: getFileInfo(params, options), где params.trackId — строка,
        // а результат имеет форму { downloadInfo: { urls: [...], url, trackId, quality, ... }, responseTime, url }.
        // Метода isTrackDownloaded / getLocalFileDownloadInfo в этой версии больше нет —
        // подменяем адрес прямо внутри downloadInfo, оставляя остальные поля как есть.
        const originalGetFileInfo = gfir.getFileInfo;
        gfir.getFileInfo = async function (params, options) {
            const trackId = params && params.trackId;
            const original = await originalGetFileInfo.apply(this, arguments);

            try {
                const replacedTrack = getReplaced(trackId);
                if (replacedTrack && replacedTrack.src !== "remote_exception") {
                    let url = replacedTrack.url;
                    let format = null;

                    if (replacedTrack.src === "local" && !replacedTrack.url) {
                        url = await getLocalTrackUrl(trackId);
                    }

                    // remote и assets-треки приходят без расширения/корректного Content-Type -
                    // скачиваем, определяем реальный формат по сигнатуре байт и заворачиваем в Blob.
                    if (url && (replacedTrack.src === "remote" || replacedTrack.src === "assets")) {
                        const res = await toPlayableBlobUrl(trackId, url);
                        url = res.url;
                        format = res.format;
                    }

                    if (url && original && original.downloadInfo) {
                        // ДО патча — полный дамп исходного downloadInfo, чтобы если и это
                        // не заиграет, было видно реальные имена полей для следующей итерации.
                        try {
                            log("original.downloadInfo ДО подмены:", JSON.stringify(original.downloadInfo, (k, v) => typeof v === "function" ? undefined : v));
                        } catch (e) {
                            log("original.downloadInfo (не сериализуется):", original.downloadInfo);
                        }

                        log("Replacing track " + trackId + " with url " + url);
                        original.downloadInfo.urls = [url];
                        original.downloadInfo.url = url;

                        if (format) {
                            patchCodecFields(original.downloadInfo, format);
                        }
                    }
                }
            } catch (e) {
                console.error("[FckCensor] Ошибка при подмене трека:", e);
            }

            return original;
        };
    }

    // === хранение подменных треков ===
    /* из базы данных */
    let localTracksUrlCache = {};
    let localTrackIds = [];

    async function getLocalTrackUrl(trackId) {
        if (localTracksUrlCache[trackId]) return localTracksUrlCache[trackId];

        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("tracks", 'readonly');
            const store = tx.objectStore("tracks");
            const request = store.get(trackId); 

            request.onsuccess = () => {
                if (request.result && request.result.data) {
                    const url = URL.createObjectURL(request.result.data);
                    localTracksUrlCache[trackId] = url;
                    resolve(url);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    // открытие базы данных
    let dbPromise = null;
    function openDB() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(ADDON_NAME + "Data", 3);

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains("tracks")) {
                        db.createObjectStore("tracks", { keyPath: "id" });
                    }

                    if (!db.objectStoreNames.contains("remote_exceptions")) {
                        db.createObjectStore("remote_exceptions", { keyPath: "id" });
                    }

                    if (!db.objectStoreNames.contains("reported_tracks")) {
                        db.createObjectStore("reported_tracks", { keyPath: "id" });
                    }
                };

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        return dbPromise;
    }

    // первоначальная загрузка треков из базы данных
    openDB().then(db => {
        const tx = db.transaction("tracks", 'readonly');
        const store = tx.objectStore("tracks");
        const request = store.getAllKeys(); 

        request.onsuccess = () => {
            localTrackIds = request.result;
            log("Loaded ", Object.keys(localTrackIds).length, "local tracks");
        };
    });

    /* из папки assets */
    let assetsTracks = {};
    function updateAssetsTracks() {
        fetch("http://localhost:2007/assets?name=" + ADDON_NAME)
            .then(response => response.json())
            .then(data => {
                Object.keys(data.files).forEach(file => {
                    const id = file.split(".")[0]
                    const url = "http://localhost:2007/assets/" + file + "?name=" + ADDON_NAME + "&"
                    assetsTracks[id] = url;
                });
                log("Tracks from assets:", assetsTracks);
            })
            .catch(err => {
                // локальный сервер assets (порт 2007, из PulseSync) не запущен в вашем моде - это нормально, просто нет локальных assets-треков
                log("Локальный сервер assets недоступен, пропускаем:", err.message);
            });
    }

    updateAssetsTracks();

    /* из репозитория */
    let remoteTracks = {};
    let remoteExceptions = [];

    fetch("https://cdn.jsdelivr.net/gh/Hazzz895/FckCensorData@main/list.json")
        .then(response => response.json())
        .then(data => {
            // Ссылки НА САМИ АУДИОФАЙЛЫ внутри списка тоже указывают на raw.githubusercontent.com —
            // переписываем и их на jsdelivr, иначе список подгрузится, а звук — нет.
            remoteTracks = {};
            for (const [id, url] of Object.entries(data.tracks)) {
                remoteTracks[id] = url.replace(
                    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?([^/]+)\/(.+)$/,
                    'https://cdn.jsdelivr.net/gh/$1/$2@$3/$4'
                );
            }
            log("Tracks from remote repository:", remoteTracks);
            openDB().then(db => {
                const tx = db.transaction("remote_exceptions", 'readonly');
                const store = tx.objectStore("remote_exceptions");
                const request = store.getAll();

                request.onsuccess = () => {
                    remoteExceptions = request.result.map(item => item.id);
                };
            });
        })
        .catch(err => {
            console.error(`[${ADDON_NAME}] Ошибка при попытке получить список треков с удалённого репозитория: `, err)
        });

    // получение ссылки на трек
    function getReplaced(trackId) {
        if (!trackId) return null;
        trackId = String(trackId);
        let url = null;
        let src = null;
        if  (localTrackIds.includes(trackId)) {
            url = localTracksUrlCache[trackId];
            src = "local";
        }
        else if (assetsTracks[trackId]) {
            url = assetsTracks[trackId];
            src = "assets";
        }
        else if (remoteExceptions.includes(trackId)) {
            url = null;
            src = "remote_exception";
        }
        else if (remoteTracks[trackId]) {
            url = remoteTracks[trackId];
            src = "remote";
        }
        return url || src ? { url, src } : null;
    }

    function isReplaced(trackId) {
        const replacedData = getReplaced(trackId);
        return !!(replacedData && replacedData.src !== "remote_exception");
    }

    // апи для отправки заблюренных треков
    const api = {
        API_URL: "https://pzomqvgckpgkshxhpite.supabase.co/rest/v1/",
        KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6b21xdmdja3Bna3NoeGhwaXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNTgzNDEsImV4cCI6MjA5MDYzNDM0MX0.ggCxM-ver3gDWUBWyhSBfy3n7rpdW8jtlxRQVCXkhNg",
        report(trackId, replaced) {
            if (!trackId) return;
            trackId = Number(trackId);
            if (isNaN(trackId) || this.reportedTracks.includes(trackId)) return;

            const targetTable = "reported_tracks";
            const body = {
                track_id: trackId,
                replaced
            }

            fetch(`${this.API_URL}${targetTable}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "apikey": this.KEY,
                    "Authorization": `Bearer ${this.KEY}`,
                },
                body: JSON.stringify(body)
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to report track. Status: ${response.status}`);
                }
                this.reportedTracks.push(trackId);
                openDB().then(db => {
                    const tx = db.transaction(targetTable, 'readwrite');
                    const store = tx.objectStore(targetTable);
                    store.put({ id: trackId });
                });
                log("Reported track " + trackId);
            })
            .catch(err => {
                console.error(`[${ADDON_NAME}] Failed to report track`, err);
            });
        },
        reportedTracks: [],
        loadReportedTracks() {
            openDB().then(db => {
                const tx = db.transaction("reported_tracks", 'readonly');
                const store = tx.objectStore("reported_tracks");
                const request = store.getAll();

                request.onsuccess = () => {
                    this.reportedTracks = request.result.map(item => item.id);
                };
            });
        },
        isReported(trackId) {
            if (!trackId) return;
            trackId = Number(trackId);
            return !isNaN(trackId) && this.reportedTracks.includes(trackId);
        }
    }

    api.loadReportedTracks();

    /* === контекстное меню подмены (сохранение в indexeddb) === */
    function onContextMenuReplaceClick(trackId, item) {
        const replaced = getReplaced(trackId);

        function reloadPlayer() { 
            const e = window.sonataState?.queueState?.currentEntity?.value?.entity;
            const mediaPlayer = window.sonataState?.currentMediaPlayer?.value?.currentMediaPlayer;
            if (e && mediaPlayer && e.entityData?.meta?.id == trackId) {
                mediaPlayer.reload(e);
                log("Player reloaded");
            }
        }

        function onSuccess() {
            reloadPlayer();
            updateReplaceItem(trackId, item);
            addReplacedMarks();
        }

        function notificate(replaced) {
            const text = !replaced ? "Трек успешно подменён" : "Трек восстановлен к оригиналу"
            postNotificationWithCover(text, trackId);
        }

        // если трек НЕ подменен, то открывается пикер файлов и затем он сохраняется в бд
        if (!replaced) {
            window.showOpenFilePicker({
                types:
                [
                    {
                        description: 'Аудио-файлы',
                        accept: { 'audio/*': ['.mp3', '.wav', '.ogg', '.flac'] }
                    }
                ],
                multiple: false 
            })
            .then(async (fileHandles) => {
                const fileHandle = fileHandles[0];

                const file = await fileHandle.getFile();
                if (!file.type.startsWith("audio/")) {
                    postNotification("Выбранный файл не является аудио-файлом.");
                    return;
                }
                const db = await openDB();

                localTrackIds.push(trackId)
                localTracksUrlCache[trackId] = URL.createObjectURL(file);

                const tx = db.transaction("tracks", 'readwrite');
                const store = tx.objectStore("tracks");
                
                store.put({ id: trackId, data: file });
                api.report(trackId, true);
                onSuccess();
                notificate(true);
                log("Added track " + trackId + " to local tracks");
            })
            .catch(err => {
                if (err.name !== 'AbortError') {
                    postNotification("Ошибка во время выбора файла, посмотрите консоль для подробной информации.")
                    console.error(`[${ADDON_NAME}] Ошибка при выборе файла:`, err);
                }
            });
        }
        // если трек есть в базе данных, то удаление
        else if (replaced.src == "local") {
            localTrackIds = localTrackIds.filter(id => id != trackId);
            
            if (localTracksUrlCache[trackId]) {
                URL.revokeObjectURL(localTracksUrlCache[trackId]);
                delete localTracksUrlCache[trackId];
            }
            
            openDB().then(db => {
                const tx = db.transaction("tracks", 'readwrite');
                const store = tx.objectStore("tracks");
                store.delete(trackId);
                onSuccess();
                notificate(false);
                log("Removed track " + trackId + " from local tracks");
            });
        }
        // если трек подменен из репозитория, то добавление в исключения
        else if (replaced.src == "remote") {
            remoteExceptions.push(trackId);
            openDB().then(db => {
                const tx = db.transaction("remote_exceptions", 'readwrite');
                const store = tx.objectStore("remote_exceptions");
                store.add({ id: trackId });
                onSuccess();
                notificate(true);
                log("Added track " + trackId + " to remote exceptions");
            });
        }
        // если трек в исключениях, то удаление оттуда
        else if (replaced.src == "remote_exception") {
            remoteExceptions = remoteExceptions.filter(id => id != trackId);
            openDB().then(db => {
                const tx = db.transaction("remote_exceptions", 'readwrite');
                const store = tx.objectStore("remote_exceptions");
                store.delete(trackId);
                onSuccess();
                notificate(false);
                log("Removed track " + trackId + " from remote exceptions");
            });
        }
        else {
            return;
        }
    }

    function updateReplaceItem(trackId, item) {
        const span = item.querySelector('span')
        const replaced = isReplaced(trackId);

        span.childNodes[0].firstElementChild.setAttribute("xlink:href", "/icons/sprite.svg#" + (replaced ? "close" : "edit") + "_xxs");
        span.childNodes[1].nodeValue = replaced ? "Удалить замену" : "Подменить трек";

        const ymTrackDownloadItem = item.parentElement?.querySelector('[data-test-id="CONTEXT_MENU_DOWNLOAD_BUTTON"]');
        if (ymTrackDownloadItem) {
            ymTrackDownloadItem.style.display = replaced ? "none" : "";
        }

        updateReportItem(trackId, item.parentElement?.querySelector('[data-test-id="CONTEXT_MENU_REPORT_BUTTON"]'))
    }

    function updateReportItem(trackId, item, forcedValue = undefined) {
        if (!item || !trackId) return;
        item.style.display = (forcedValue !== undefined && forcedValue !== null ? forcedValue : (api.isReported(trackId) || getReplaced(trackId))) ? "none" : "";
    }

    // следим за dom-изменениями
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;
                // появилось ли контекстное меню трека?
                const trackMenu = node?.querySelector("[data-test-id='TRACK_CONTEXT_MENU']:not(:has([data-test-id='CONTEXT_MENU_REPLACE_BUTTON']))");
                if (trackMenu) {
                    const button = (trackMenu.parentElement?.ariaLabelledByElements || trackMenu.ariaLabelledByElements)?.[0];
                    if (button) {
                        function createItems(trackId) {
                            const replaced = getReplaced(trackId);
                            if (trackId && replaced?.src != "assets") {
                                const downloadItem = trackMenu.querySelector('[data-test-id="CONTEXT_MENU_DOWNLOAD_BUTTON"]')
                                if (downloadItem) {
                                    // создаем кнопку подмены
                                    const replaceItem = downloadItem.cloneNode(true)
                                    replaceItem.setAttribute('data-test-id', 'CONTEXT_MENU_REPLACE_BUTTON');
                                    replaceItem.addEventListener('click', () => onContextMenuReplaceClick(trackId, replaceItem));

                                    downloadItem.parentElement.insertBefore(replaceItem, downloadItem.nextSibling);
                                    updateReplaceItem(trackId, replaceItem);

                                    // создаем кнопку репорта блюра
                                    const reportItem = downloadItem.cloneNode(true)
                                    reportItem.setAttribute('data-test-id', 'CONTEXT_MENU_REPORT_BUTTON');

                                    const span = reportItem.querySelector("span");
                                    span.childNodes[0].firstElementChild.setAttribute("xlink:href", "/icons/sprite.svg#" + "attention_xxxl");
                                    span.childNodes[1].nodeValue = "Сообщить о цензуре";

                                    reportItem.addEventListener('click', () => {
                                        api.report(trackId, false);
                                        updateReportItem(trackId, reportItem, true)
                                        postNotificationWithCover("Спасибо! Трек скоро будет добавлен в список автоматически заменяемых", trackId)
                                    });

                                    downloadItem.parentElement.insertBefore(reportItem, replaceItem.nextSibling);
                                    updateReportItem(trackId, reportItem)
                                }
                            }
                        }
                        // а относится ли контекстное меню к плееру?
                        if (button.matches("[data-test-id='PLAYERBAR_DESKTOP_CONTEXT_MENU_BUTTON'], [data-test-id='FULLSCREEN_PLAYER_CONTEXT_MENU_BUTTON']")) {
                            const entity = window.pulsesyncApi?.getCurrentTrack();
                            createItems(entity?.id)
                        }
                        else {
                            const source = button.closest('.CommonTrack_root__i6shE');
                            if (source) {
                                const trackId = getTrackIdFromNode(source);
                                if (trackId) {
                                    createItems(trackId)
                                }
                            }
                        }
                    }
                }
            })
            
            addReplacedMarks(mutation.target);
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    /* === иконка подмены === */
    function createMark(node) {
        const metaCtr = node.querySelector(".Meta_titleContainer__gDuXr:not(:has(.Meta_replacedMarkContainer))")
        if (!metaCtr) return;
        const span = document.createElement("span");

        span.classList.add("Meta_replacedMarkContainer", "Meta_explicitMarkContainer__BxMQg")
        span.innerHTML = 
        `<svg 
            class="ExplicitMarkIcon_explicitMark__0BPeQ Meta_explicitMark__ocnCV Rkdd2vKC_3xa1eUdRdHP" 
            focusable="false" 
            aria-label="Трек подменен аддоном ${ADDON_NAME}" 
            data-test-id="REPLACED_MARK_ICON">
                <use xlink:href="/icons/sprite.svg#edit_xxs">
                </use>
        </svg>`

        const trackOptionsButton = metaCtr.querySelector(`div:has([data-test-id="PLAYERBAR_DESKTOP_CONTEXT_MENU_BUTTON"])`);
        if (trackOptionsButton) {
            metaCtr.insertBefore(span, trackOptionsButton);
        }
        else {
            metaCtr.appendChild(span)
        }

        span.addEventListener("mouseenter", (ev) => {
            removeTooltip();
            const tooltip = document.createElement("div");
            tooltip.id = "FckCensorTooltip";
            const bounding = ev.target.getBoundingClientRect();
            tooltip.innerHTML = 
            `<div 
                class="QhR4J536RmNHBB5bZYwF TooltipWithTitle_root__7jLY3" 
                data-test-id="TOOLTIP_WITH_TITLE" 
                tabindex="-1"
                role="tooltip" 
                style="position: absolute; left: 0px; top: 0px; visibility: visible; transform: translate(${bounding.left}px, ${bounding.top + bounding.height}px);">
                <div 
                    class="_MWOVuZRvUQdXKTMcOPx Ai2iRN9elHpk_u5splD6 _3_Mxw7Si7j2g4kWjlpR Fqg1VWCJUfasVVxqICeO">
                    <div 
                        class="TooltipWithTitle_text__ElBtq">
                        <span 
                            class="_MWOVuZRvUQdXKTMcOPx Ai2iRN9elHpk_u5splD6 ZYV27jeWd30QDXu4GhaH TooltipWithTitle_description__HsGcR"
                            >${ev.target.firstElementChild.ariaLabel}</span>
                    </div>
                </div>
                </div>`
            document.body.appendChild(tooltip);
            tooltip.addEventListener("mouseenter", (ev) => ev.target.remove());
        });
        span.addEventListener("mouseleave", (_) => removeTooltip());
    }

    function removeTooltip() {
        document.getElementById("FckCensorTooltip")?.remove();
    }

    function getTrackIdFromNode(node) {
        let trackId = null;
        const reactFiberProp = Object.keys(node).find(key => key.startsWith("__reactFiber"));
        if (reactFiberProp) {
            const fiber = node[reactFiberProp];
            const children = fiber.memoizedProps.children
            if (children) {
                for (const child of children) {
                    trackId = child?.props?.track?.id;
                    if (trackId) break;
                }
            }
        }

        if (!trackId) {
            const intersection = node.dataset.intersectionPropertyId;
            trackId = intersection?.match(/track_(\d+)/)?.[1];
        }
        return trackId;
    }

    function addReplacedMarks(node = document.body) {
        const trackContainers = node.querySelectorAll('.CommonTrack_root__i6shE')
        trackContainers.forEach(ctr => {
            const trackId = getTrackIdFromNode(ctr);
            if (trackId) {
                const replaced = isReplaced(trackId);
                if (replaced) {
                    createMark(ctr);
                }
                else {
                    ctr.querySelector(".Meta_replacedMarkContainer")?.remove()
                }
            }
        })
        updatePlayerbarReplacedMark(node);
    }

    function updatePlayerbarReplacedMark(node = document.body) {
        try {
            const playerContainers = node.querySelectorAll('[class*="PlayerBarDesktopWithBackgroundProgressBar_player__"], [data-test-id="PLAYERBAR_DESKTOP"], [data-test-id="FULLSCREEN_PLAYER_FULLSCREEN_CONTENT"]');
            if (playerContainers.length == 0) return;
            const entity = pulsesyncApi.getCurrentTrack();
            const replaced = isReplaced(entity?.id);
            playerContainers.forEach(ctr => {
                if (replaced) {
                    createMark(ctr);
                }
                else {
                    ctr.querySelectorAll(".Meta_replacedMarkContainer").forEach(rpctr => {
                        rpctr.remove();
                    })
                }
            })
        }
        catch (e) {
            console.error(e)
        }
    }

    window.pulsesyncApi._waitForPlayer(player => {
        updatePlayerbarReplacedMark()
        player.state?.queueState?.currentEntity?.onChange(() => updatePlayerbarReplacedMark())
    })

    addReplacedMarks();
})();