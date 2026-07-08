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
  // Never mutates the DOM (no marker-node insertion) — editors like Slate/React
  // based message boxes can wipe out inserted nodes mid-render, which used to
  // throw and silently kill the overlay for that field.
  function getEditableCaretRect(el) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);

    const style = window.getComputedStyle(el);
    const charWidth = parseFloat(style.fontSize) * 0.6 || 8;
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 18;

    let rect = range.getBoundingClientRect();
    const isEmpty = !rect || (rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0);

    if (isEmpty) {
      // Empty line / empty element: derive position from the container's
      // own box, but NEVER borrow its full width — otherwise an empty
      // message box (whose only child is the contenteditable root itself)
      // makes the caret as wide as the entire field.
      let node = range.startContainer;
      let containerEl = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

      let posRect = null;
      if (containerEl && containerEl !== el) {
        const rects = containerEl.getClientRects();
        if (rects.length) posRect = rects[0];
      }
      if (!posRect) {
        posRect = (containerEl || el).getBoundingClientRect();
      }

      rect = { left: posRect.left, top: posRect.top, width: 0, height: posRect.height || lineHeight };
    }

    return {
      left: rect.left,
      top: rect.top,
      width: Math.max(rect.width, charWidth),
      height: rect.height || lineHeight,
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

    const switchingFields = !!activeEl;
    if (activeEl) activeEl.style.caretColor = '';
    activeEl = el;
    activeEl.style.caretColor = 'transparent'; // hide native caret

    if (switchingFields) {
      // Snap instantly to the new field instead of sliding across the page
      // from wherever the overlay previously was.
      caret.style.transition = 'none';
      updateCaret();
      // Force reflow so the 'none' transition is actually applied before
      // we restore animated transitions for movement within this field.
      void caret.offsetHeight;
      caret.style.transition = `left ${TRANSITION_MS}ms ease, top ${TRANSITION_MS}ms ease, height ${TRANSITION_MS}ms ease, width ${TRANSITION_MS}ms ease, opacity 90ms linear`;
    } else {
      caret.style.opacity = '0'; // first-ever focus: fade in from nothing rather than sliding in
      updateCaret();
    }
  }

  function realTarget(e) {
    // e.target can be a shadow host (wrong element) for components that use
    // shadow DOM internally; composedPath()[0] is the true originating node.
    const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
    return (path && path.length) ? path[0] : e.target;
  }

  document.addEventListener('focusin', (e) => {
    const t = realTarget(e);
    if (isEditable(t)) activate(t);
  });

  document.addEventListener('focusout', (e) => {
    if (realTarget(e) === activeEl) hideOverlay();
  });

  // Recompute on typing, clicking, arrow-key navigation, scrolling, resizing.
  ['input', 'keyup', 'click', 'select', 'pointerup'].forEach(evt =>
    document.addEventListener(evt, () => { if (activeEl) requestAnimationFrame(updateCaret); }, true)
  );
  document.addEventListener('selectionchange', () => { if (activeEl) requestAnimationFrame(updateCaret); });
  window.addEventListener('scroll', () => { if (activeEl) updateCaret(); }, true);
  window.addEventListener('resize', () => { if (activeEl) updateCaret(); });

})();
