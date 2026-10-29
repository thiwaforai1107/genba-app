// 現場写真の撮影。工程を選ぶ → 撮るものを選ぶ → 撮る → まとめて送る。
// 現場の事情に合わせた工夫：
//  ・QRから開けば現場は決まっている（現場を選ぶ欄がない）
//  ・撮るものリストで撮り漏れを防ぐ。撮ると次の撮るものへ自動で進む
//  ・着工前／前の塗り工程の写真を半透明で重ね、同じ構図で撮れる
//  ・電子黒板風（社内・お客様向け）。水平器。手袋でも押せる大きなシャッター
//  ・送る前に端末の中で縮小（約4MB→0.3MB）。電波が弱くても送れる
import { icon } from './icons.js';
import { NOTE_CHIPS } from './data.js';
import {
  S, commit, esc, uid, worker, site, kindOf, photosOf, checklist, currentStep, ghostFor, imgSrc, putBlob,
  fmtYmd, fmtTime, weather, wxLabel, remoteOn, enqueue, fileName, pad,
} from './store.js';
import { toast, sheet, vibrate } from './ui.js';
import { go, avatar } from './app.js';

const SAMPLE = {
  before: 'n1899', scaffold: 'flow-1', wash: 'craft-hp', repair: 'craft-seal', mask: 'flow-3',
  coat1: 'craft-wall', coat2: 'craft-spray', coat3: 'n1906', trim: 'craft-rail', done: 'n1963', fix: 'n1908',
  remove: 's2418', prep: 's2422', carry: 's2427', sheet: 's2431', layer1: 's2435', layer2: 's2437', top: 's2439',
  kere: 'craft-rail', rust1: 'craft-rail', rust2: 'craft-gate', mid: 'craft-rail', fin: 'craft-gate',
  tape: 'craft-seal', primer: 'craft-seal', fill: 'craft-seal2', finish: 'craft-seal2',
};
const SAMPLE_BY_SHOT = { 'coat3:1': 'n1904', 'coat2:1': 'n1904', 'coat1:1': 'svc-roof', 'coat1:2': 'craft-tint', 'coat2:2': 'craft-tint', 'coat3:2': 'craft-tint', 'done:1': 'n1904', 'done:2': 'n1909', 'before:1': 'n1903' };

export function cameraView(q) {
  const ps = S.punches.filter((p) => p.w === S.me).slice(-1)[0];
  const sid = q.site || S._camSite || (ps && ps.site) || (S.sites.find((s) => s.status === 'active') || S.sites[0]).id;
  const s = site(sid);
  if (!s) return { title: '現場が見つかりません', backTo: '#/', html: '<div class="page"><div class="empty">QRの現場が見つかりません。</div></div>' };
  S._camSite = sid;
  return { full: true, html: '<div class="cam" id="cam"></div>', mount: (root) => mountCam(root, s, q) };
}

function mountCam(root, s, q) {
  const k = kindOf(s);
  const cam = root.querySelector('#cam');
  const st = {
    step: q.step || (s.status === 'done' ? 'fix' : currentStep(s.id).k),
    shot: 0, tray: [], grid: S.settings.gridDefault !== false, board: S.settings.boardDefault !== false,
    ghost: true, ghostOp: 0.38, level: false, stream: null, facing: 'environment', wx: null, sending: false,
  };
  const steps = k.steps;
  pickShot();
  weather(s.lat, s.lng).then((w) => { st.wx = w; drawBoardDom(); });

  function pickShot() {
    const cl = checklist(s.id).find((x) => x.k === st.step) || { shots: steps.find((x) => x.k === st.step).shots.map(() => ({ done: false })) };
    const taken = (i) => cl.shots[i]?.done || st.tray.some((t) => t.step === st.step && t.shot === i);
    const n = steps.find((x) => x.k === st.step).shots.length;
    let i = 0; while (i < n && taken(i)) i++;
    st.shot = i < n ? i : 0;
  }
  const stepDef = () => steps.find((x) => x.k === st.step);
  const shotDef = () => stepDef().shots[st.shot] || stepDef().shots[0];

  cam.innerHTML = `
    <div class="cam__top">
      <div class="cam__bar">
        <button class="iconbtn" data-c="close" aria-label="閉じる">${icon('close')}</button>
        <div class="cam__site"><span class="en">${s.id}・現場写真</span><b>${esc(s.name)}</b></div>
        <span class="avatars">${avatar(S.me)}</span>
        <button class="iconbtn" data-c="site" aria-label="現場を変える">${icon('switch')}</button>
      </div>
      <div class="chips chips--scroll" id="c-steps"></div>
      <div class="cam__shots" id="c-shots"></div>
    </div>
    <div class="cam__view" id="c-view">
      <video id="c-video" playsinline muted autoplay></video>
      <img class="cam__ghost hide" id="c-ghost" alt="">
      <span class="cam__ghostlbl hide" id="c-ghostlbl"></span>
      <div class="cam__grid ${st.grid ? '' : 'hide'}" id="c-grid"></div>
      <div class="cam__level hide" id="c-level"></div>
      <div class="board ${st.board ? '' : 'hide'}" id="c-board"></div>
      <div class="cam__tools">
        <button class="tool ${st.ghost ? 'on' : ''}" data-c="ghost" aria-label="同じ構図">${icon('ghost')}<small>同じ構図</small></button>
        <button class="tool ${st.board ? 'on' : ''}" data-c="board" aria-label="黒板">${icon('board')}<small>黒板</small></button>
        <button class="tool ${st.grid ? 'on' : ''}" data-c="grid" aria-label="グリッド">${icon('grid3')}<small>グリッド</small></button>
        <button class="tool" data-c="level" aria-label="水平">${icon('level')}<small>水平</small></button>
        <button class="tool" data-c="flip" aria-label="カメラ切替">${icon('flip')}<small>切替</small></button>
        <button class="tool" data-c="sample" aria-label="見本の写真">${icon('image')}<small>見本</small></button>
      </div>
      <input type="range" class="ghostRange hide" id="c-range" min="0.1" max="0.8" step="0.02" value="${st.ghostOp}" aria-label="重ねる濃さ">
      <div class="cam__empty hide" id="c-empty"></div>
      <div class="cam__hint hide" id="c-hint"></div>
      <div class="flash" id="c-flash"></div>
    </div>
    <div class="cam__bottom">
      <div class="tray" id="c-tray"></div>
      <button class="shutter" data-c="shoot" aria-label="撮影"><i></i></button>
      <div class="cam__send" id="c-send"></div>
    </div>
    <input type="file" id="c-file" accept="image/*" capture="environment" hidden multiple>`;

  const $ = (sel) => cam.querySelector(sel);
  const video = $('#c-video');

  // ---------- 表示の更新 ----------
  function renderSteps() {
    const cl = checklist(s.id);
    $('#c-steps').innerHTML = steps.map((x) => {
      const c = cl.find((y) => y.k === x.k);
      const inTray = st.tray.filter((t) => t.step === x.k).length;
      const done = c ? c.done : false;
      return `<button class="chip ${x.k === st.step ? 'on' : ''} ${done ? 'chip--done' : ''}" data-step="${x.k}"><span class="dot" style="background:${x.c}"></span>${esc(x.l)}${inTray ? `<span class="cnt">+${inTray}</span>` : ''}</button>`;
    }).join('');
    const on = $('#c-steps .chip.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
  function renderShots() {
    const cl = checklist(s.id).find((x) => x.k === st.step);
    $('#c-shots').innerHTML = stepDef().shots.map(([label, part], i) => {
      const done = (cl && cl.shots[i] && cl.shots[i].done) || st.tray.some((t) => t.step === st.step && t.shot === i);
      return `<button class="shot ${done ? 'done' : ''} ${i === st.shot ? 'on' : ''}" data-shot="${i}"><i>${done ? '✓' : i + 1}</i>${esc(label)}<span style="opacity:.6;font-weight:500">・${esc(part)}</span></button>`;
    }).join('');
  }
  function renderGhost() {
    const g = ghostFor(s.id, st.step, st.shot);
    const img = $('#c-ghost'); const lbl = $('#c-ghostlbl'); const range = $('#c-range');
    const toolG = cam.querySelector('[data-c="ghost"]');
    toolG.style.display = g ? '' : 'none';
    if (g && st.ghost) {
      img.src = imgSrc(g.p, 'f'); img.style.opacity = st.ghostOp; img.classList.remove('hide');
      lbl.textContent = `${g.why}（${fmtYmd(g.p.at)}）`; lbl.classList.remove('hide'); range.classList.remove('hide');
    } else { img.classList.add('hide'); lbl.classList.add('hide'); range.classList.add('hide'); }
  }
  function drawBoardDom() {
    const b = $('#c-board'); if (!b) return;
    const rows = boardRows();
    b.innerHTML = `<table>${rows.map(([a, v]) => `<tr><th>${esc(a)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
    const pos = S.settings.boardPos;
    if (pos) { b.style.left = pos.x + '%'; b.style.top = pos.y + '%'; b.style.bottom = 'auto'; }
  }
  function boardRows() {
    const w = st.wx;
    return [
      ['工事名', s.name],
      ['工程', `${stepDef().l}　${shotDef()[0]}`],
      ['部位', shotDef()[1]],
      ['天候', w ? `${wxLabel(w.code)} ${w.t}℃ ${w.h}%` : '—'],
      ['撮影日', fmtYmd(new Date())],
      ['施工', '有限会社 西島塗装'],
    ];
  }
  function renderTray() {
    const n = st.tray.length; const last = st.tray[n - 1];
    $('#c-tray').innerHTML = n ? `<button class="tray__thumb" data-c="review"><img src="${last.url}" alt=""><span class="tray__n">${n}</span></button>` : '';
    $('#c-send').innerHTML = n ? `<button class="btn btn--primary" data-c="send">${icon('send')}送る</button>` : '';
  }
  function hint(t) { const h = $('#c-hint'); h.textContent = t; }
  function refresh() { renderSteps(); renderShots(); renderGhost(); drawBoardDom(); renderTray(); const sd = shotDef(); hint(`撮るもの：${stepDef().l}「${sd[0]}」`); }
  refresh();

  // ---------- カメラ ----------
  async function startCam() {
    stopCam();
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
      st.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: st.facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      video.srcObject = st.stream; await video.play().catch(() => {});
      $('#c-empty').classList.add('hide');
    } catch (e) {
      const el = $('#c-empty'); el.classList.remove('hide');
      el.innerHTML = `<div>${icon('camera', 'xl')}<p>カメラを使えませんでした。<br>写真を選ぶか、見本の写真で体験できます。</p>
        <div class="grid2" style="max-width:320px;margin:0 auto"><button class="btn btn--primary" data-c="pick">${icon('image')}写真を選ぶ</button><button class="btn btn--ghost" data-c="sample">見本で試す</button></div></div>`;
    }
  }
  function stopCam() { if (st.stream) { st.stream.getTracks().forEach((t) => t.stop()); st.stream = null; } }
  startCam();

  // 撮影して、見えている範囲で切り抜き、長辺1600pxに縮小する
  async function shoot(source) {
    if (st.sending) return;
    const view = $('#c-view').getBoundingClientRect();
    let sw, sh, draw, orig = 0;
    if (source) {
      sw = source.width; sh = source.height; draw = source.img; orig = source.size || 0;
    } else {
      if (!st.stream || !video.videoWidth) { toast('カメラの準備中です。少し待つか「見本」で試せます', 'warn'); return; }
      sw = video.videoWidth; sh = video.videoHeight; draw = video;
    }
    // object-fit: cover と同じ切り抜き
    const scale = Math.max(view.width / sw, view.height / sh);
    const cw = view.width / scale, chh = view.height / scale;
    const cx = (sw - cw) / 2, cy = (sh - chh) / 2;
    const long = 1600; const r = Math.min(1, long / Math.max(cw, chh));
    const ow = Math.round(cw * r), oh = Math.round(chh * r);
    const c = document.createElement('canvas'); c.width = ow; c.height = oh;
    const ctx = c.getContext('2d');
    ctx.drawImage(draw, cx, cy, cw, chh, 0, 0, ow, oh);
    if (st.board) {
      const b = $('#c-board').getBoundingClientRect();
      const f = ow / view.width;
      drawBoard(ctx, (b.left - view.left) * f, (b.top - view.top) * f, b.width * f, b.height * f, boardRows());
    }
    if (!orig) {
      const full = document.createElement('canvas'); full.width = sw; full.height = sh;
      full.getContext('2d').drawImage(draw, 0, 0, sw, sh);
      orig = await new Promise((res) => full.toBlob((bb) => res(bb ? bb.size * 1.6 : 3.8e6), 'image/jpeg', 0.95));
    }
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
    const tc = document.createElement('canvas'); const tr = 360 / Math.max(ow, oh);
    tc.width = Math.round(ow * tr); tc.height = Math.round(oh * tr);
    tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
    const thumb = await new Promise((res) => tc.toBlob(res, 'image/jpeg', 0.75));
    const item = { id: uid('p'), blob, thumb, url: URL.createObjectURL(thumb), size: blob.size, orig, step: st.step, shot: st.shot, part: shotDef()[1], label: shotDef()[0], note: '', at: new Date().toISOString(), wx: st.wx ? { t: st.wx.t, h: st.wx.h, code: st.wx.code } : null };
    st.tray.push(item);
    const fl = $('#c-flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
    vibrate(25);
    const prevLabel = shotDef()[0];
    pickShot();
    const allDone = stepDef().shots.every((_, i) => checklist(s.id).find((x) => x.k === st.step)?.shots[i]?.done || st.tray.some((t) => t.step === st.step && t.shot === i));
    refresh();
    toast(allDone ? `${stepDef().l}の撮るものが揃いました` : `「${prevLabel}」✓　次は「${shotDef()[0]}」`, 'ok', 1800);
  }

  async function loadSample() {
    const key = SAMPLE_BY_SHOT[`${st.step}:${st.shot}`] || SAMPLE[st.step] || 'craft-wall';
    const img = new Image(); img.src = `assets/demo/${key}.webp`;
    await img.decode().catch(() => {});
    await shoot({ img, width: img.naturalWidth, height: img.naturalHeight, size: 3.6e6 + Math.random() * 9e5 });
  }
  async function fromFiles(files) {
    for (const f of files) {
      let bmp = null;
      try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); } catch (e) {
        const img = new Image(); img.src = URL.createObjectURL(f); await img.decode().catch(() => {}); bmp = img;
      }
      await shoot({ img: bmp, width: bmp.width || bmp.naturalWidth, height: bmp.height || bmp.naturalHeight, size: f.size });
    }
  }

  // ---------- 水平器 ----------
  const onOri = (e) => {
    const lv = $('#c-level'); if (!lv) return;
    const portrait = window.innerHeight >= window.innerWidth;
    const a = portrait ? (e.gamma || 0) : (e.beta || 0);
    lv.style.transform = `rotate(${-a}deg)`;
    lv.classList.toggle('ok', Math.abs(a) < 1.5);
  };
  async function toggleLevel(btn) {
    st.level = !st.level; btn.classList.toggle('on', st.level); $('#c-level').classList.toggle('hide', !st.level);
    if (st.level) {
      try { if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission(); } catch (e) {}
      window.addEventListener('deviceorientation', onOri);
    } else window.removeEventListener('deviceorientation', onOri);
  }

  // ---------- 黒板を動かす ----------
  const board = $('#c-board');
  let drag = null;
  board.addEventListener('pointerdown', (e) => { const r = board.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; board.setPointerCapture(e.pointerId); });
  board.addEventListener('pointermove', (e) => {
    if (!drag) return; const v = $('#c-view').getBoundingClientRect(); const r = board.getBoundingClientRect();
    const x = Math.min(v.width - r.width, Math.max(0, e.clientX - v.left - drag.dx));
    const y = Math.min(v.height - r.height, Math.max(0, e.clientY - v.top - drag.dy));
    board.style.left = x + 'px'; board.style.top = y + 'px'; board.style.bottom = 'auto';
    S.settings.boardPos = { x: (x / v.width) * 100, y: (y / v.height) * 100 };
  });
  board.addEventListener('pointerup', () => { drag = null; commit('board'); });

  // ---------- 操作 ----------
  cam.addEventListener('click', async (e) => {
    const stepB = e.target.closest('[data-step]');
    if (stepB) { st.step = stepB.dataset.step; pickShot(); refresh(); return; }
    const shotB = e.target.closest('[data-shot]');
    if (shotB) { st.shot = Number(shotB.dataset.shot); refresh(); return; }
    const b = e.target.closest('[data-c]'); if (!b) return;
    const c = b.dataset.c;
    if (c === 'close') { stopCam(); history.length > 1 ? history.back() : go('#/'); }
    if (c === 'shoot') shoot();
    if (c === 'sample') loadSample();
    if (c === 'pick') $('#c-file').click();
    if (c === 'grid') { st.grid = !st.grid; b.classList.toggle('on', st.grid); $('#c-grid').classList.toggle('hide', !st.grid); S.settings.gridDefault = st.grid; commit('set'); }
    if (c === 'board') { st.board = !st.board; b.classList.toggle('on', st.board); board.classList.toggle('hide', !st.board); S.settings.boardDefault = st.board; commit('set'); if (st.board) toast('黒板は社内・お客様向けの記録用です（公共工事の提出用ではありません）', 'ok', 2600); }
    if (c === 'ghost') { st.ghost = !st.ghost; b.classList.toggle('on', st.ghost); renderGhost(); }
    if (c === 'level') toggleLevel(b);
    if (c === 'flip') { st.facing = st.facing === 'environment' ? 'user' : 'environment'; startCam(); }
    if (c === 'site') pickSite();
    if (c === 'review') review();
    if (c === 'send') send();
  });
  $('#c-range').addEventListener('input', (e) => { st.ghostOp = Number(e.target.value); $('#c-ghost').style.opacity = st.ghostOp; });
  $('#c-file').addEventListener('change', (e) => { fromFiles([...e.target.files]); e.target.value = ''; });
  const onKey = (e) => { if (e.code === 'Space' && !e.repeat && !document.querySelector('.sheet')) { e.preventDefault(); shoot(); } };
  window.addEventListener('keydown', onKey);

  function pickSite() {
    const list = S.sites.filter((x) => x.status !== 'done' || x.id === s.id);
    sheet(`<div class="sheet__title">現場を変える</div><div class="sheet__sub">ふだんは現場のQRを読むので、ここは使いません。</div>
      <div class="list">${list.map((x) => `<a class="li" href="#/camera?site=${x.id}" data-close><span class="li__ic">${icon('building', 'sm')}</span><div class="li__body"><b>${esc(x.name)}</b><span>${x.id}・${esc(x.title)}</span></div>${x.id === s.id ? `<span class="check on">${icon('check')}</span>` : ''}</a>`).join('')}</div>`);
  }

  function review() {
    const html = () => `<div class="sheet__title">送る前の確認（${st.tray.length}枚）</div><div class="sheet__sub">ひとことは任意です。よく使う言葉は押すだけで入ります。</div>
      <div class="stack" id="rv">${st.tray.map((t, i) => {
        const sd = steps.find((x) => x.k === t.step);
        return `<div class="card" style="display:grid;grid-template-columns:96px 1fr;gap:12px;padding:10px">
          <img src="${t.url}" style="width:96px;height:96px;object-fit:cover;border-radius:10px" alt="">
          <div style="min-width:0"><div class="row" style="gap:6px;flex-wrap:wrap"><span class="tag" style="background:${sd.c};color:#fff">${esc(sd.l)}</span><span class="tag">${esc(t.label)}</span>
            <button class="tag" data-part="${i}">${esc(t.part)} ▾</button><button class="iconbtn" style="width:32px;height:32px;margin-left:auto" data-del="${i}" aria-label="削除">${icon('trash', 'sm')}</button></div>
            <div class="chips" style="gap:5px;margin-top:8px">${NOTE_CHIPS.slice(0, 5).map((n) => `<button class="chip ${t.note.includes(n) ? 'on' : ''}" style="min-height:30px;font-size:11.5px;padding:0 9px" data-note="${i}" data-v="${n}">${n}</button>`).join('')}</div></div></div>`;
      }).join('')}</div>
      <div class="grid2" style="margin-top:14px"><button class="btn btn--ghost" data-close>続けて撮る</button><button class="btn btn--primary" id="rv-send">${icon('send')}${st.tray.length}枚を送る</button></div>`;
    sheet(html(), {
      onOpen(el, close) {
        el.addEventListener('click', (e) => {
          const n = e.target.closest('[data-note]');
          if (n) { const t = st.tray[n.dataset.note]; const v = n.dataset.v; t.note = t.note.includes(v) ? t.note.replace(v, '').replace(/^、|、$|、、/g, '') : (t.note ? `${t.note}、${v}` : v); n.classList.toggle('on'); return; }
          const d = e.target.closest('[data-del]');
          if (d) { st.tray.splice(Number(d.dataset.del), 1); close(); refresh(); if (st.tray.length) setTimeout(review, 400); return; }
          const p = e.target.closest('[data-part]');
          if (p) { const t = st.tray[p.dataset.part]; const parts = k.parts; t.part = parts[(parts.indexOf(t.part) + 1) % parts.length]; p.textContent = `${t.part} ▾`; return; }
          if (e.target.closest('#rv-send')) { close(); setTimeout(send, 300); }
        });
      },
    });
  }

  async function send() {
    if (!st.tray.length || st.sending) return;
    st.sending = true;
    const items = st.tray.splice(0);
    const totalOrig = items.reduce((n, t) => n + t.orig, 0); const totalNew = items.reduce((n, t) => n + t.size, 0);
    const first = { site: s.id, step: items[0].step, part: items[0].part, at: items[0].at };
    const ov = document.createElement('div'); ov.className = 'send';
    const C = 2 * Math.PI * 42;
    ov.innerHTML = `<div class="send__box">
      <svg class="send__ring" viewBox="0 0 96 96"><circle class="bg" cx="48" cy="48" r="42"/><circle class="fg" cx="48" cy="48" r="42" stroke-dasharray="${C}" stroke-dashoffset="${C}"/><path class="ok" d="M32 49l11 11 22-24" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div style="font-size:18px;font-weight:700;letter-spacing:.08em" id="sd-t">送信しています…</div>
      <div class="send__list">
        <div>${icon('check')}写真を縮小　${(totalOrig / 1e6).toFixed(1)}MB → ${(totalNew / 1e6).toFixed(2)}MB</div>
        <div>${icon('check')}ファイル名を付け替え（お客様の名前は入りません）</div>
        <div>${icon('check')}${esc(s.id)}／工程フォルダに保存</div>
        <div>${icon('check')}写真台帳に記録（撮影者・日時・工程・部位）</div>
        <div>${icon('check')}${remoteOn() ? 'スプレッドシートへ送信（PCの台帳に表示）' : 'お客様の工事アルバムに反映'}</div>
      </div>
      <div class="send__fn">${esc(fileName(first))}${items.length > 1 ? ` ほか${items.length - 1}枚` : ''}</div>
      <div class="grid2 hide" id="sd-btns" style="margin-top:18px"><button class="btn btn--ghost" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.3)" data-sd="more">続けて撮る</button><a class="btn btn--primary" href="#/site/${s.id}" data-sd="site">現場を見る</a></div>
    </div>`;
    document.body.appendChild(ov);
    const fg = ov.querySelector('.fg'); const rows = ov.querySelectorAll('.send__list div');
    for (let i = 0; i < items.length; i++) {
      const t = items[i];
      await putBlob(t.id, t.blob); await putBlob(`${t.id}_t`, t.thumb);
      const p = { id: t.id, site: s.id, step: t.step, shot: t.shot, part: t.part, by: S.me, at: t.at, note: t.note, wx: t.wx, flags: { album: !steps.find((x) => x.k === t.step).internal, post: false }, blob: true, size: t.size, pending: remoteOn() };
      S.photos.push(p);
      if (remoteOn()) enqueue('addPhoto', { photo: { ...p, fn: fileName(p) } });
    }
    commit('photos');
    for (let i = 0; i < rows.length; i++) {
      await new Promise((r) => setTimeout(r, 260));
      rows[i].classList.add('on');
      fg.style.strokeDashoffset = C * (1 - (i + 1) / rows.length);
    }
    await new Promise((r) => setTimeout(r, 250));
    ov.classList.add('done'); vibrate([20, 40, 20]);
    ov.querySelector('#sd-t').textContent = `${items.length}枚を送りました`;
    ov.querySelector('#sd-btns').classList.remove('hide');
    items.forEach((t) => URL.revokeObjectURL(t.url));
    st.sending = false;
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sd]'); if (!b) return;
      if (b.dataset.sd === 'more') { ov.remove(); refresh(); }
      if (b.dataset.sd === 'site') { stopCam(); ov.remove(); }
    });
    refresh();
  }

  return () => {
    stopCam();
    window.removeEventListener('deviceorientation', onOri);
    window.removeEventListener('keydown', onKey);
    document.querySelectorAll('.send').forEach((x) => x.remove());
    st.tray.forEach((t) => URL.revokeObjectURL(t.url));
  };
}

// 黒板を写真に焼き込む
function drawBoard(ctx, x, y, w, h, rows) {
  ctx.save();
  const pad = Math.max(2, w * 0.012);
  ctx.fillStyle = '#c9b48a'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#1e4d36'; ctx.fillRect(x + pad, y + pad, w - pad * 2, h - pad * 2);
  const ix = x + pad, iy = y + pad, iw = w - pad * 2, ih = h - pad * 2;
  const rh = ih / rows.length; const c1 = iw * 0.34;
  ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = Math.max(1, w * 0.004);
  ctx.fillStyle = '#fff';
  const fs = Math.max(9, rh * 0.5);
  ctx.textBaseline = 'middle';
  rows.forEach(([a, v], i) => {
    const ry = iy + rh * i;
    ctx.strokeRect(ix, ry, c1, rh); ctx.strokeRect(ix + c1, ry, iw - c1, rh);
    ctx.font = `700 ${fs}px "Zen Kaku Gothic New", "Yu Gothic", sans-serif`;
    ctx.fillText(a, ix + rh * 0.25, ry + rh / 2, c1 - rh * 0.4);
    ctx.font = `500 ${fs}px "Zen Kaku Gothic New", "Yu Gothic", sans-serif`;
    ctx.fillText(v, ix + c1 + rh * 0.25, ry + rh / 2, iw - c1 - rh * 0.4);
  });
  ctx.restore();
}
