(() => {
  if (window.__tuneRiftYnisonHookInstalled) return;
  window.__tuneRiftYnisonHookInstalled = true;

  const OriginalWebSocket = window.WebSocket;
  if (!OriginalWebSocket) return;

  const report = (event, extra = {}) => {
    window.postMessage({ type: 'tunerift:ynison-diagnostic', event, ...extra }, '*');
  };
  report('hook-ready');
  setTimeout(() => report('hook-ready'), 1000);

  function parseMessage(rawData) {
    if (typeof rawData === 'string') {
      try { return JSON.parse(rawData); } catch { return null; }
    }
    if (rawData && typeof rawData === 'object' && !ArrayBuffer.isView(rawData)) return rawData;
    return null;
  }

  function publishTiming(rawData) {
    const message = parseMessage(rawData);
    if (!message) return;

    const state = message?.player_state || message?.playerState || message?.state || message;
    const status = state?.status || state?.player_state || state;
    const durationMs = Number(
      status?.duration_ms ?? status?.durationMs ?? status?.duration
      ?? state?.duration_ms ?? state?.durationMs
    );
    const positionMs = Number(
      status?.progress_ms ?? status?.position_ms ?? status?.positionMs ?? status?.progressMs
      ?? state?.progress_ms ?? state?.position_ms ?? state?.positionMs
    );
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    if (!Number.isFinite(positionMs) || positionMs < 0) return;

    const pausedValue = status?.paused ?? status?.is_paused ?? status?.isPaused
      ?? state?.paused ?? state?.is_paused ?? state?.isPaused;
    const paused = pausedValue === true || pausedValue === 1 || pausedValue === 'true';
    window.postMessage({
      type: 'tunerift:ynison-timing',
      durationMs,
      positionMs,
      paused
    }, '*');
    report('timing-received', { durationMs, positionMs, paused });
  }

  function inspectFrame(data) {
    if (typeof data === 'string') {
      publishTiming(data);
      return;
    }
    if (data instanceof ArrayBuffer) {
      publishTiming(new TextDecoder().decode(data));
      return;
    }
    if (data instanceof Blob) data.text().then(publishTiming).catch(() => {});
  }

  window.WebSocket = new Proxy(OriginalWebSocket, {
    construct(target, args) {
      const socket = Reflect.construct(target, args);
      socket.addEventListener('message', (event) => inspectFrame(event.data));
      return socket;
    }
  });
})();
