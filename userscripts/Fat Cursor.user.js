// ==UserScript==
// @name         Fat Animated Caret
// @namespace    himi.fatcaret
// @version      1.0
// @description  Replaces the native text caret with a block-shaped caret that smoothly animates between positions. Works in <input>, <textarea>, and contenteditable elements.
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---- tunables ----
  const CARET_COLOR = '#ebdbb2'; // fat caret fill

  const TRANSITION_MS = 80;                        // movement animation speed
  const BLINK = true;                               // blink when idle
  const BLINK_INTERVAL_MS = 530;

  // ---- overlay element ----
  const caret = document.createElement('div');
  caret.id = '__fatCaretOverlay';
  Object.assign(caret.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: '0px',
    height: '0px',
    background: CARET_COLOR,
    pointerEvents: 'none',
    zIndex: '2147483647',
    transition: `left ${TRANSITION_MS}ms ease, top ${TRANSITION_MS}ms ease, height ${TRANSITION_MS}ms ease, width ${TRANSITION_MS}ms ease, opacity 90ms linear`,
    opacity: '0',
    borderRadius: '1px',
  });
  document.documentElement.appendChild(caret);

  let activeEl = null;
  let blinkTimer = null;

  function stopBlink() {
    if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
    caret.style.opacity = '1';
  }

  function startBlinkIdle() {
    if (!BLINK) return;
    stopBlink();
    let on = true;
    blinkTimer = setInterval(() => {
      on = !on;
      caret.style.opacity = on ? '1' : '0';
    }, BLINK_INTERVAL_MS);
  }

  // Restart blink timer on any movement (so it doesn't blink mid-motion)
  function kickBlink() {
    stopBlink();
    clearTimeout(kickBlink._t);
    kickBlink._t = setTimeout(startBlinkIdle, BLINK_INTERVAL_MS);
  }

  function hideOverlay() {
    caret.style.opacity = '0';
    if (activeEl) activeEl.style.caretColor = '';
    activeEl = null;
    stopBlink();
  }

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      return ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(type);
    }
    return el.isContentEditable;
  }

  // ---- mirror-div technique for input/textarea caret pixel position ----
  const mirrorDiv = document.createElement('div');
  const mirrorProps = [
    'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust',
    'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
    'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordWrap',
  ];

  function getInputCaretRect(el) {
    const style = window.getComputedStyle(el);
    const isInput = el.tagName === 'INPUT';

    Object.assign(mirrorDiv.style, {
      position: 'absolute',
      visibility: 'hidden',
      whiteSpace: isInput ? 'pre' : 'pre-wrap',
      wordWrap: isInput ? 'normal' : 'break-word',
      top: '0px',
      left: '-9999px',
    });
    mirrorProps.forEach(p => { mirrorDiv.style[p] = style[p]; });
    mirrorDiv.style.width = style.width;

    document.body.appendChild(mirrorDiv);

    const caretIndex = el.selectionEnd ?? el.value.length;
    const before = el.value.substring(0, caretIndex);
    const after = el.value.substring(caretIndex) || '.'; // ensure a char to measure width against

    mirrorDiv.textContent = before;
    const span = document.createElement('span');
    span.textContent = after.charAt(0);
    mirrorDiv.appendChild(span);

    const elRect = el.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const mirrorRect = mirrorDiv.getBoundingClientRect();

    const offsetX = spanRect.left - mirrorRect.left - el.scrollLeft;
    const offsetY = spanRect.top - mirrorRect.top - el.scrollTop;

    document.body.removeChild(mirrorDiv);

    return {
      left: elRect.left + offsetX,
      top: elRect.top + offsetY,
      width: Math.max(spanRect.width, 8),
      height: spanRect.height || parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2,
    };
  }

  // ---- contenteditable caret rect via Selection API ----
  function getEditableCaretRect(el) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);

    let rect = range.getClientRects()[0];
    if (!rect) {
      // fallback: measure a temporary zero-width char
      const marker = document.createTextNode('\u200b');
      range.insertNode(marker);
      rect = marker.getBoundingClientRect
        ? range.getBoundingClientRect()
        : null;
      marker.parentNode && marker.parentNode.removeChild(marker);
      if (!rect) return null;
    }

    const style = window.getComputedStyle(el);
    const charWidth = parseFloat(style.fontSize) * 0.6 || 8;
    return {
      left: rect.left,
      top: rect.top,
      width: Math.max(rect.width, charWidth),
      height: rect.height || parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2,
    };
  }

  function updateCaret() {
    if (!activeEl || !document.contains(activeEl)) { hideOverlay(); return; }

    let rect;
    if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
      rect = getInputCaretRect(activeEl);
    } else {
      rect = getEditableCaretRect(activeEl);
    }
    if (!rect) return;

    caret.style.left = `${rect.left}px`;
    caret.style.top = `${rect.top}px`;
    caret.style.width = `${rect.width}px`;
    caret.style.height = `${rect.height}px`;
    caret.style.opacity = '1';
    kickBlink();
  }

  function activate(el) {
    if (activeEl === el) { updateCaret(); return; }
    if (activeEl) activeEl.style.caretColor = '';
    activeEl = el;
    activeEl.style.caretColor = 'transparent'; // hide native caret
    updateCaret();
  }

  document.addEventListener('focusin', (e) => {
    if (isEditable(e.target)) activate(e.target);
  });

  document.addEventListener('focusout', (e) => {
    if (e.target === activeEl) hideOverlay();
  });

  // Recompute on typing, clicking, arrow-key navigation, scrolling, resizing.
  ['input', 'keyup', 'click', 'select'].forEach(evt =>
    document.addEventListener(evt, () => { if (activeEl) updateCaret(); }, true)
  );
  document.addEventListener('selectionchange', () => { if (activeEl) updateCaret(); });
  window.addEventListener('scroll', () => { if (activeEl) updateCaret(); }, true);
  window.addEventListener('resize', () => { if (activeEl) updateCaret(); });

})();
