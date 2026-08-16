(function () {
  function addDragStripOnce() {
    if (!document.body) return false;
    if (document.querySelector('.ymelectron-drag-strip')) return true;
    const strip = document.createElement('div');
    strip.className = 'ymelectron-drag-strip';
    document.body.appendChild(strip);
    return true;
  }

  // document.body иногда ещё не существует в момент инъекции (SPA пересобирает DOM
  // прямо во время загрузки) — поэтому не полагаемся на один запуск, а пробуем
  // несколько раз с небольшой паузой, пока не получится.
  function addDragStripWithRetry(attemptsLeft) {
    if (addDragStripOnce()) return;
    if (attemptsLeft <= 0) {
      console.error('[ui-tweaks] не удалось добавить драг-полосу — document.body так и не появился');
      return;
    }
    setTimeout(() => addDragStripWithRetry(attemptsLeft - 1), 200);
  }

  addDragStripWithRetry(25); // до ~5 секунд попыток

  // На всякий случай — если SPA полностью заменит body при следующей навигации внутри сайта
  document.addEventListener('DOMContentLoaded', () => addDragStripWithRetry(10));

  // --- Косметика экрана "Не получилось войти по лицу или отпечатку" ---
  // Теперь этот экран показывается мгновенно (см. extensions/skip-webauthn-wait),
  // но выглядит как ошибка — прячем иконку/лишнюю кнопку и переименовываем оставшуюся.
  const MAX_W = 260, MAX_H = 170, MAX_DESCENDANTS = 25, MAX_DEPTH = 6;

  function findSafeTarget(textNode) {
    let el = textNode.parentElement, prev = el, steps = 0;
    while (el && steps < MAX_DEPTH) {
      const rect = el.getBoundingClientRect();
      const descendants = el.querySelectorAll('*').length;
      if (rect.width > MAX_W || rect.height > MAX_H || descendants > MAX_DESCENDANTS) return prev;
      const tag = el.tagName;
      if (tag === 'A' || tag === 'BUTTON' || el.getAttribute('role') === 'button') return el;
      prev = el;
      el = el.parentElement;
      steps++;
    }
    return prev;
  }

  function tweakAuthFallbackScreen() {
    // Кнопка "Войти" в блоке "Моя волна" на главной, когда не залогинен —
    // кликаем сразу, чтобы окно входа открывалось без лишнего клика.
    // Два разных варианта разметки этого блока встречались на практике —
    // проверяем оба класса.
    document.querySelectorAll('[class*="VibeBlock_button__"], [class*="VibePageFreemiumBlock_button__"]').forEach((loginBtn) => {
      if (loginBtn.dataset.ymelectronAutoClicked !== '1') {
        loginBtn.dataset.ymelectronAutoClicked = '1';
        loginBtn.click();
      }
    });

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent && node.textContent.trim();
      if (!text) continue;

      if (text === 'Попробовать ещё раз') {
        const target = findSafeTarget(node);
        if (target && target.dataset.ymelectronHidden !== '1') {
          target.style.display = 'none';
          target.dataset.ymelectronHidden = '1';
        }
      }

      if (text === 'Не получилось войти по лицу или отпечатку') {
        // Заголовок-ошибку тоже прячем/переименовываем на нейтральный текст
        node.textContent = 'Вход';
      }

      if (text === 'Попробуйте снова или войдите другим способом') {
        node.textContent = 'Выбери способ входа';
      }

      if (text === 'Войти другим способом') {
        const target = findSafeTarget(node);
        if (target && target.dataset.ymelectronAutoClicked !== '1') {
          target.dataset.ymelectronAutoClicked = '1';
          const clickable = target.closest('button, a, [role="button"]') || target;
          clickable.click();
        }
        node.textContent = 'Войти по email или телефону';
      }
    }
  }

  const authObserver = new MutationObserver(() => tweakAuthFallbackScreen());
  authObserver.observe(document.documentElement, { childList: true, subtree: true });
  tweakAuthFallbackScreen();
})();
