// В Electron нет настоящего диалога Touch ID (см. TOUCH_ID.md — работает только
// в подписанной сборке), поэтому сайт ~20 секунд ждёт реального железного
// тайм-аута, прежде чем сам покажет "Не получилось войти... Войти другим
// способом". Мы просто ускоряем этот момент — как только сайт вызывает
// navigator.credentials.get() (это и есть попытка биометрии), сразу отвечаем
// стандартной для WebAuthn ошибкой отказа. Дальше сайт САМ обрабатывает эту
// ошибку и показывает свой обычный fallback-экран — никакого своего UI мы не
// рисуем, просто не даём ждать зря.
(function () {
    if (!navigator.credentials || typeof navigator.credentials.get !== 'function') return;

    const originalGet = navigator.credentials.get.bind(navigator.credentials);

    navigator.credentials.get = function (options) {
        // Трогаем только именно WebAuthn-запросы (у них есть options.publicKey),
        // обычные credential-запросы (пароли и т.п.) не перехватываем.
        if (options && options.publicKey) {
            return Promise.reject(new DOMException('Platform authenticator unavailable in this app', 'NotAllowedError'));
        }
        return originalGet(options);
    };

    console.log('[skip-webauthn-wait] активен — WebAuthn-запросы будут отклоняться мгновенно');
})();
