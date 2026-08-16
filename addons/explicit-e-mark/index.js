(() => {
  'use strict';

  const ADDON = 'tunerift-explicit-e-mark';
  const EXPLICIT_MARK_SELECTOR = '[class*="Meta_explicitMarkContainer"], [class*="ExplicitMarkContainer"]';
  const FOOTNOTE_PATTERN = /Эти материалы отмечены значком\s*\(\s*!\s*\)/giu;
  let scheduled = false;

  const makeMark = () => {
    const mark = document.createElement('span');
    mark.className = 'tunerift-explicit-e-mark';
    mark.textContent = 'E';
    mark.setAttribute('aria-label', 'Контент с маркировкой E');
    mark.setAttribute('title', 'Контент с маркировкой E');
    return mark;
  };

  const replaceExplicitMarks = () => {
    document.querySelectorAll(EXPLICIT_MARK_SELECTOR).forEach((container) => {
      // FckCensor deliberately reuses Yandex's explicit-mark class for its own
      // "track replaced" icon. It must retain its original icon and tooltip.
      const isFckCensorMark = container.classList.contains('Meta_replacedMarkContainer') ||
        Boolean(container.querySelector('[data-test-id="REPLACED_MARK_ICON"]'));
      if (isFckCensorMark || container.dataset.tuneriftExplicitE === 'true') return;

      container.replaceChildren(makeMark());
      container.dataset.tuneriftExplicitE = 'true';
    });
  };

  const replaceFootnote = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    for (const textNode of nodes) {
      const parent = textNode.parentElement;
      if (!parent || parent.closest('[data-tunerift-explicit-e="true"]')) continue;
      const text = textNode.nodeValue;
      if (text && FOOTNOTE_PATTERN.test(text)) {
        FOOTNOTE_PATTERN.lastIndex = 0;
        textNode.nodeValue = text.replace(FOOTNOTE_PATTERN, 'Эти материалы отмечены знаком E');
      }
      FOOTNOTE_PATTERN.lastIndex = 0;
    }
  };

  const apply = () => {
    scheduled = false;
    replaceExplicitMarks();
    replaceFootnote();
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(apply);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  schedule();
  console.info('[Explicit E Mark] активен');
})();
