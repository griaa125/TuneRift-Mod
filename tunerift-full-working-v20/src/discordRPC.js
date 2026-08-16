const RPC = require('discord-rpc');

// Discord Application ID для текущего профиля Rich Presence.
// При необходимости его можно временно переопределить через DISCORD_CLIENT_ID.
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1124055337234858005';
const PRESENCE_NAME = 'Яндекс Музыка';

const SET_ACTIVITY_TIMEOUT_MS = 3000;
const RECONNECT_INTERVAL_MS = 30000;
const AFK_CLEAR_TIMEOUT_MS = 15 * 60 * 1000; // очистить статус после 15 минут паузы

// throttle — перенесено из YandexMusicModClient (src/main/lib/utils.js),
// не даёт долбить Discord запросами чаще раза в SET_ACTIVITY_TIMEOUT_MS.
function throttle(callee, delay) {
  let lastCall = 0;
  let timeout = null;
  let lastArgs, lastContext;
  return function (...args) {
    const now = Date.now();
    const remaining = delay - (now - lastCall);
    lastContext = this;
    lastArgs = args;
    if (remaining <= 0) {
      if (timeout) { clearTimeout(timeout); timeout = null; }
      lastCall = now;
      callee.apply(lastContext, lastArgs);
    } else if (!timeout) {
      timeout = setTimeout(() => {
        timeout = null;
        lastCall = Date.now();
        callee.apply(lastContext, lastArgs);
      }, remaining);
    }
  };
}

let rpc = null;
let isReady = false;
let isReconnecting = false;
let enabled = true;

let afkTimeoutId = null;
let reconnectTimeoutId = null;
let lastActivityJson = null; // для сравнения "изменилось ли что-то реально"
let lastTimelineDiagnostic = null;

function string2Discord(str) {
  if (!str) return str;
  if (str.length <= 1) str += 'ㅤ';
  if (str.length > 128) str = str.substring(0, 127) + '…';
  return str;
}

function normalizeCoverUrl(url) {
  if (!url) return undefined;
  if (url.startsWith('//')) url = `https:${url}`;
  return url.replace('%%', '400x400');
}

function buildActivityObject(track, isPlaying) {
  if (!track || !track.title) return null;

  const artist = Array.isArray(track.artists)
    ? track.artists.map(a => (typeof a === 'string' ? a : a?.name)).filter(Boolean).join(', ')
    : track.artists;

  const trackUrl = track.id
    ? `https://music.yandex.ru/track/${track.id}?utm_source=discord&utm_medium=rich_presence_click`
    : undefined;
  const coverUrl = normalizeCoverUrl(track.coverUrl);

  const durationMs = Number(track.durationMs);
  const positionMs = Number(track.positionMs);
  const hasTimeline = isPlaying
    && Number.isFinite(durationMs) && durationMs > 0
    && Number.isFinite(positionMs) && positionMs >= 0 && positionMs < durationMs;
  // Discord показывает полосу прогресса только при наличии endTimestamp.
  // Вычисляем обе метки из реальной позиции HTML-аудио, а не от момента опроса.
  const startTimestamp = hasTimeline ? Date.now() - positionMs : (isPlaying ? Date.now() : undefined);
  const endTimestamp = hasTimeline ? startTimestamp + durationMs : undefined;

  const activity = {
    type: 2, // 2 = "Слушает" (как у Spotify), а не "Играет в"
    details: string2Discord(track.title),
    detailsUrl: trackUrl,
    state: string2Discord(artist) || undefined,
    startTimestamp: isPlaying ? startTimestamp : undefined,
    endTimestamp: isPlaying ? endTimestamp : undefined,
    // Как в оригинальном YandexMusicModClient: показываем обложку трека.
    // Если MediaSession не дала artwork, оставляем логотип приложения.
    largeImageKey: coverUrl || 'ym_logo',
    largeImageText: 'TuneRift Mod',
    largeImageUrl: trackUrl,
    // Ключи соответствуют ассетам оригинального мода.
    smallImageKey: isPlaying ? 'playing' : 'paused',
    smallImageText: isPlaying ? 'Играет' : 'Пауза',
    instance: false
  };

  // Не перечисляется и поэтому не уходит в Discord: используется только для
  // диагностики значения, из-за которого может отсутствовать endTimestamp.
  Object.defineProperty(activity, '__tuneriftTimeline', {
    value: { durationMs, positionMs, isPlaying, hasTimeline },
    enumerable: false
  });
  return activity;
}

function initRPC() {
  rpc = new RPC.Client({ transport: 'ipc' });
  // discord-rpc 4.0.1 не переносит args.type в IPC-пакет SET_ACTIVITY.
  // Подставляем type: 2 непосредственно перед отправкой: Discord отобразит
  // активность как «Слушает», а не применит стандартный «Играет в».
  const request = rpc.request.bind(rpc);
  rpc.request = (command, args) => {
    if (command === 'SET_ACTIVITY' && args?.activity) {
      args.activity.type = 2;
      args.activity.name = PRESENCE_NAME;
    }
    return request(command, args);
  };
  isReady = false;

  rpc.on('ready', () => console.log('[discord-rpc] ready'));
  rpc.on('connected', () => {
    isReady = true;
    console.log('[discord-rpc] connected');
  });
  rpc.on('disconnected', () => {
    isReady = false;
    console.log('[discord-rpc] disconnected');
    startReconnectLoop();
  });
  rpc.on('error', (e) => console.error('[discord-rpc] error', e.message || e));
}

async function tryConnect() {
  try {
    await rpc.connect(CLIENT_ID);
    return true;
  } catch (e) {
    console.error('[discord-rpc] connect error (Discord запущен?):', e.message || e);
    return false;
  }
}

function startReconnectLoop() {
  if (isReconnecting || !enabled) return;
  isReconnecting = true;

  const attempt = async () => {
    if (!enabled) { isReconnecting = false; return; }
    rpc?.destroy().catch(() => {});
    rpc = null;
    initRPC();
    const connected = await tryConnect();
    if (!connected) {
      reconnectTimeoutId = setTimeout(attempt, RECONNECT_INTERVAL_MS);
    } else {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
      isReconnecting = false;
    }
  };
  attempt();
}

function sendActivity(activityObject) {
  if (!rpc || !isReady) return;

  // Одно диагностическое сообщение на трек: оно не влияет на Discord и
  // показывает, дошли ли до RPC обе метки, нужные для прогресс-бара.
  const timelineDiagnostic = `${activityObject.details}|${Boolean(activityObject.startTimestamp)}|${Boolean(activityObject.endTimestamp)}`;
  if (timelineDiagnostic !== lastTimelineDiagnostic) {
    lastTimelineDiagnostic = timelineDiagnostic;
    console.log('[discord-rpc] timeline', {
      track: activityObject.details,
      hasStart: Boolean(activityObject.startTimestamp),
      hasEnd: Boolean(activityObject.endTimestamp),
      startTimestamp: activityObject.startTimestamp,
      endTimestamp: activityObject.endTimestamp,
      input: activityObject.__tuneriftTimeline
    });
  }

  const json = JSON.stringify(activityObject);
  if (json === lastActivityJson) return; // ничего не изменилось — не спамим Discord
  lastActivityJson = json;
  rpc.setActivity(activityObject).catch((e) => {
    console.error('[discord-rpc] setActivity error:', e.message || e);
  });
}

const throttledSendActivity = throttle(sendActivity, SET_ACTIVITY_TIMEOUT_MS);

function initDiscordRPC(isEnabled) {
  enabled = isEnabled;
  if (!enabled) return;
  initRPC();
  tryConnect().then((connected) => {
    if (!connected) startReconnectLoop();
  });
}

function setDiscordEnabled(isEnabled) {
  enabled = isEnabled;
  if (enabled) {
    if (!rpc) initDiscordRPC(true);
  } else {
    clearActivity();
    clearTimeout(afkTimeoutId);
    clearTimeout(reconnectTimeoutId);
    afkTimeoutId = null;
    reconnectTimeoutId = null;
    isReconnecting = false;
    if (rpc) { rpc.destroy().catch(() => {}); rpc = null; isReady = false; }
  }
}

function updateActivity(trackInfo) {
  if (!enabled) return;
  if (!rpc) { initDiscordRPC(true); return; }
  if (!isReady) return;

  const isPlaying = !!trackInfo.isPlaying;

  // AFK-таймер: если стоит на паузе достаточно долго — полностью убираем статус
  clearTimeout(afkTimeoutId);
  afkTimeoutId = null;
  if (!isPlaying) {
    afkTimeoutId = setTimeout(() => {
      console.log('[discord-rpc] пауза слишком долго — убираю статус');
      rpc?.clearActivity().catch(() => {});
      lastActivityJson = null;
      afkTimeoutId = null;
    }, AFK_CLEAR_TIMEOUT_MS);
  }

  const activityObject = buildActivityObject(trackInfo, isPlaying);
  if (activityObject) throttledSendActivity(activityObject);
}

function clearActivity() {
  if (rpc && isReady) rpc.clearActivity().catch(() => {});
  lastActivityJson = null;
  clearTimeout(afkTimeoutId);
  afkTimeoutId = null;
}

module.exports = { initDiscordRPC, updateActivity, clearActivity, setDiscordEnabled };
