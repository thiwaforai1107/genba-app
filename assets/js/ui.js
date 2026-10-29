// 画面部品：トースト・ボトムシート・QR・数字のカウントアップ・比較スライダー
import { icon } from './icons.js';
import { esc } from './store.js';

export function toast(msg, kind = 'ok', ms = 2600) {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.innerHTML = `${icon(kind === 'warn' ? 'alert' : 'check')}<span>${msg}</span>`;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}

let sheetClose = null;
export function sheet(html, { onOpen, onClose, cls = '' } = {}) {
  closeSheet(true);
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const el = document.createElement('div'); el.className = `sheet ${cls}`; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="sheet__grab"></div>${html}`;
  document.body.append(scrim, el);
  requestAnimationFrame(() => { scrim.classList.add('on'); el.classList.add('on'); });
  const close = (instant) => {
    if (!el.isConnected) return;
    scrim.classList.remove('on'); el.classList.remove('on');
    const rm = () => { scrim.remove(); el.remove(); };
    instant ? rm() : setTimeout(rm, 380);
    sheetClose = null; onClose && onClose();
  };
  scrim.addEventListener('click', () => close());
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  // 下へスワイプで閉じる
  let y0 = null;
  el.addEventListener('touchstart', (e) => { if (el.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchmove', (e) => { if (y0 === null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) el.style.transform = `translateY(${dy}px)`; }, { passive: true });
  el.addEventListener('touchend', (e) => { if (y0 === null) return; const dy = e.changedTouches[0].clientY - y0; el.style.transform = ''; y0 = null; if (dy > 110) close(); });
  sheetClose = close;
  onOpen && onOpen(el, close);
  return { el, close };
}
export function closeSheet(instant) { if (sheetClose) sheetClose(instant); }

export function qrSvg(text, cell = 4) {
  // eslint-disable-next-line no-undef
  const qr = window.qrcode(0, 'M');
  qr.addData(text); qr.make();
  return qr.createSvgTag({ cellSize: cell, margin: 0, scalable: true });
}

export function countUp(root = document) {
  root.querySelectorAll('[data-count]').forEach((el) => {
    const to = Number(el.dataset.count); const dur = 900; const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(to * e).toLocaleString('ja-JP');
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// ビフォー・アフターの比較スライダー
export function baHtml(beforeSrc, afterSrc, bl = 'BEFORE', al = 'AFTER') {
  return `<div class="ba" data-ba style="--x:50%">
    <img src="${beforeSrc}" alt="施工前">
    <img class="ba__after" src="${afterSrc}" alt="施工後">
    <span class="ba__lbl ba__lbl--b">${esc(bl)}</span><span class="ba__lbl ba__lbl--a">${esc(al)}</span>
    <div class="ba__bar"></div><div class="ba__knob">${icon('compare', 'sm')}</div>
  </div>`;
}
export function bindBA(root = document) {
  root.querySelectorAll('[data-ba]').forEach((el) => {
    if (el._ba) return; el._ba = true;
    const set = (cx) => { const r = el.getBoundingClientRect(); const x = Math.min(100, Math.max(0, ((cx - r.left) / r.width) * 100)); el.style.setProperty('--x', x + '%'); };
    let on = false;
    el.addEventListener('pointerdown', (e) => { on = true; el.setPointerCapture(e.pointerId); set(e.clientX); });
    el.addEventListener('pointermove', (e) => { if (on) set(e.clientX); });
    el.addEventListener('pointerup', () => { on = false; });
    // 最初に少し動かして「動かせる」ことを見せる
    let t = 0; const t0 = performance.now();
    const intro = (now) => { t = (now - t0) / 1400; if (t > 1) { el.style.setProperty('--x', '50%'); return; } el.style.setProperty('--x', (50 + Math.sin(t * Math.PI * 2) * 18) + '%'); requestAnimationFrame(intro); };
    const io = new IntersectionObserver((ents) => { if (ents[0].isIntersecting) { requestAnimationFrame(intro); io.disconnect(); } }, { threshold: .6 });
    io.observe(el);
  });
}

export function vibrate(ms = 18) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

export function copyText(t) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
  const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove();
  return Promise.resolve();
}

export function swipe(color = '#ee6a1f') {
  const el = document.querySelector('.swipe'); if (!el) return;
  el.style.background = color; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
}
