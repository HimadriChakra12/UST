// ==UserScript==
// @name         Blindness Effect
// @namespace    https://github.com/user/blindness-effect
// @version      2.0.0
// @description  Simulates tunnel vision / blindness effect following the mouse cursor. Zero-lag canvas rendering.
// @author       You
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    radius: 120,
    blur: 28,
    darkness: 0.97,
    toggleKey: '~',
  };

  let enabled = false;
  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;

  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: '2147483647',
    display: 'none',
  });

  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (enabled) draw(mouseX, mouseY);
  }
  resize();
  document.documentElement.appendChild(canvas);

  function draw(x, y) {
    const w = canvas.width, h = canvas.height;
    const r = CONFIG.radius;
    const b = CONFIG.blur;
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r + b);
    grad.addColorStop(0,           'rgba(0,0,0,0)');
    grad.addColorStop(r / (r + b), 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${CONFIG.darkness})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (enabled) draw(mouseX, mouseY);
  }, { passive: true, capture: true });

  window.addEventListener('resize', resize, { passive: true });

  function setEnabled(state) {
    enabled = state;
    canvas.style.display = enabled ? 'block' : 'none';
    dot.style.background = enabled ? '#4ade80' : '#f87171';
    if (enabled) draw(mouseX, mouseY);
  }

  document.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.key.toUpperCase() === CONFIG.toggleKey.toUpperCase()) {
      setEnabled(!enabled);
    }
  });

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed',
    bottom: '20px',
    left: '20px',
    zIndex: '2147483646',
    background: 'rgba(15,15,15,0.85)',
    color: '#f5f5f5',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '13px',
    padding: '10px 14px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backdropFilter: 'blur(6px)',
    boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
    userSelect: 'none',
    pointerEvents: 'auto',
  });

  const dot = document.createElement('span');
  dot.style.cssText = 'width:12px;height:12px;border-radius:50%;background:#f87171;flex-shrink:0;cursor:pointer;';
  dot.title = 'Shortcut: Shift+B';
  dot.addEventListener('mouseenter', () => { panel.style.background = 'rgba(40,40,40,0.95)'; });
  dot.addEventListener('mouseleave', () => { panel.style.background = 'rgba(15,15,15,0.85)'; });
  dot.addEventListener('click', () => setEnabled(!enabled));

  panel.appendChild(dot);
  document.documentElement.appendChild(panel);

})();
