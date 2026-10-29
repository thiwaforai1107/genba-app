// 西島塗装 現場アプリ — 画面の切り替えと、ホーム・現場・メニュー
import { icon, mark } from './icons.js';
import { COMPANY, KINDS, MODULES } from './data.js';
import {
  S, init, save, commit, onChange, resetAll, esc, uid, worker, site, kindOf, photosOf, imgTag, imgSrc, hydrate,
  weather, paintJudge, wxIcon, wxLabel, stateOf, punchesOf, currentStep, checklist, progress, missing, coatMap,
  fmtDate, fmtTime, ago, dkey, isToday, remoteOn, pull, flush, gasTest,
} from './store.js';
import { toast, sheet, closeSheet, qrSvg, countUp, swipe } from './ui.js';
import { clockView } from './field.js';
import { cameraView } from './camera.js';
import { ledgerView, dashView } from './office.js';
import { albumsView, albumView, writerView } from './customer.js';

export const ctx = { go, rerender, openPhone, siteCard, avatar, stepperHtml, coatHtml, back };

// ---------- 共通の部品 ----------
export function avatar(w, cls = '') {
  w = typeof w === 'string' ? worker(w) : w;
  return `<span class="avatar ${cls}" style="--c:${w.c}" title="${esc(w.full)}">${esc(w.name.slice(0, 1))}</span>`;
}
export function stepperHtml(siteId) {
  const s = site(siteId); const cl = checklist(siteId);
  const cur = s.status === 'done' ? null : currentStep(siteId);
  const ci = cur ? cl.findIndex((x) => x.k === cur.k) : cl.length;
  return `<div class="stepper">${cl.map((st, i) => `<i class="${s.status === 'done' || i < ci ? 'done' : i === ci && s.status === 'active' ? 'now' : ''}" title="${esc(st.l)}"></i>`).join('')}</div>
  <div class="stepper-lbl"><span>${s.status === 'done' ? '<b>完了</b>' : s.status === 'plan' ? '着工前' : `いま：<b>${esc(cur.l)}</b>`}</span><span>${cl.length}工程</span></div>`;
}
export function coatHtml(siteId, big = false) {
  const cm = coatMap(siteId);
  if (!big) {
    const all = cm.map((c) => c.coats);
    const n = (i) => all.every((a) => a[i]);
    return `<span class="coat" title="3回塗り">${[0, 1, 2].map((i) => `<i class="${n(i) ? 'on' : ''}"></i>`).join('')}</span>`;
  }
  const s = site(siteId); const k = kindOf(s);
  const names = [1, 2, 3].map((c) => (k.steps.find((x) => x.coat === c) || {}).l || '');
  return `<div class="coatgrid" style="grid-template-columns:repeat(${Math.max(2, cm.length)},1fr)">${cm.map((c) => `
    <div class="coatcell"><b>${esc(c.part)}</b><span class="coat" style="width:100%">${c.coats.map((on) => `<i class="${on ? 'on' : ''}"></i>`).join('')}</span>
    <small>${c.coats.filter(Boolean).length}/3　${c.coats.map((on, i) => (on ? names[i] : '')).filter(Boolean).slice(-1)[0] || '未着手'}</small></div>`).join('')}</div>`;
}
export function siteCard(s, i = 0) {
  const ph = photosOf(s.id);
  const cover = s.status === 'done' ? imgSrc(ph.filter((p) => p.step === 'done')[0] || ph[ph.length - 1], 'f') : (s.cover || (ph.length ? imgSrc(ph[ph.length - 1], 'f') : ''));
  const st = { active: '<span class="tag tag--o">施工中</span>', done: '<span class="tag tag--g">完了</span>', plan: '<span class="tag">着工予定</span>' }[s.status];
  const miss = missing(s.id).length;
  return `<a class="sitecard rise d${i + 1}" href="#/site/${s.id}">
    <div class="sitecard__img" style="background-image:url('${cover || ''}')${cover ? '' : ';background:var(--ink-3)'}">
      <span class="sitecard__no tag tag--ink en">${s.id}</span>
      <div class="sitecard__ttl"><b>${esc(s.name)}</b><span>${esc(s.title)}</span></div>
    </div>
    <div class="sitecard__body">
      <div class="row row--between"><div class="row" style="gap:6px">${st}${s.public ? '<span class="tag tag--b">公共</span>' : ''}${miss ? `<span class="tag tag--r">撮り漏れ ${miss}</span>` : ''}</div>
        <div class="avatars">${s.crew.map((w) => avatar(w)).join('')}</div></div>
      ${stepperHtml(s.id)}
    </div></a>`;
}

// ---------- 画面の切り替え ----------
const ROUTES = [
  [/^#\/?$/, home],
  [/^#\/clock/, clockView],
  [/^#\/camera/, cameraView],
  [/^#\/sites$/, sitesView],
  [/^#\/site\/([\w-]+)/, siteView],
  [/^#\/ledger/, ledgerView],
  [/^#\/albums/, albumsView],
  [/^#\/album\/([\w-]+)/, albumView],
  [/^#\/writer/, writerView],
  [/^#\/dash/, dashView],
  [/^#\/menu/, menuView],
];
let cleanup = null; let current = null; let lastHash = '';

export function go(hash) { if (location.hash === hash) rerender(); else location.hash = hash; }
export function back(fallback = '#/') { if (history.length > 1 && document.referrer !== '' ) history.back(); else go(fallback); }
function params() { const q = location.hash.split('?')[1] || ''; return Object.fromEntries(new URLSearchParams(q)); }

function route() {
  const h = location.hash || '#/';
  const path = h.split('?')[0];
  for (const [re, view] of ROUTES) {
    const m = path.match(re);
    if (m) return { view, args: m.slice(1), q: params() };
  }
  return { view: home, args: [], q: {} };
}

export function rerender(keepScroll = true) {
  const y = window.scrollY;
  render(true);
  if (keepScroll) window.scrollTo(0, y);
}

function render(isRe = false) {
  const r = route();
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  if (!isRe) { document.querySelectorAll('.viewer, .send').forEach((x) => x.remove()); closeSheet(true); }
  const v = r.view(r.q, ...r.args) || {};
  current = { ...v, r };
  document.body.classList.toggle('full', !!v.full);
  document.body.classList.toggle('bare', !!v.bare);
  const app = document.getElementById('app');
  app.className = v.full || v.bare ? '' : 'app';
  if (v.full || v.bare) {
    app.innerHTML = `<div id="view">${v.html || ''}</div>`;
  } else {
    app.innerHTML = shell(v);
  }
  const root = document.getElementById('view');
  if (!isRe) window.scrollTo(0, 0);
  hydrate(root);
  countUp(root);
  if (v.mount) cleanup = v.mount(root, r.q) || null;
  const tb = document.querySelector('.topbar');
  if (tb) { const f = () => tb.classList.toggle('scrolled', window.scrollY > 4); f(); window.onscroll = f; }
}

function shell(v) {
  const mods = (k) => S.modules[k];
  const sideItem = (href, ic, l, pl = '', key = '') => {
    const on = (location.hash || '#/').split('?')[0] === href || (key && (location.hash || '').startsWith(key));
    return `<a class="side__item ${on ? 'on' : ''}" href="${href}">${icon(ic)}<span>${l}</span>${pl ? `<span class="pl">${pl}</span>` : ''}</a>`;
  };
  const tabs = [
    ['#/', 'home', 'ホーム', true],
    ['#/clock', 'clock', '出退勤', mods('clock')],
    ['#/camera', 'camera', '撮影', mods('camera'), true],
    ['#/ledger', 'grid', '台帳', mods('ledger')],
    ['#/menu', 'menu', 'メニュー', true],
  ];
  const cur = (location.hash || '#/').split('?')[0];
  const isOn = (h) => (h === '#/' ? cur === '#/' || cur === '' : cur.startsWith(h));
  return `
  <aside class="side">
    <a class="brand" href="#/">${mark(36)}<span class="brand__txt"><b>${COMPANY.short}</b><span>GENBA APP</span></span></a>
    <div class="side__group">TODAY</div>
    ${sideItem('#/', 'home', 'ホーム')}
    ${mods('dash') ? sideItem('#/dash', 'chart', '社長ダッシュボード', 'C') : ''}
    <div class="side__group">現場</div>
    ${mods('clock') ? sideItem('#/clock', 'clock', '出退勤', '', '#/clock') : ''}
    ${mods('camera') ? sideItem('#/camera', 'camera', '現場写真を撮る', '', '#/camera') : ''}
    ${sideItem('#/sites', 'building', '現場一覧', '', '#/site')}
    <div class="side__group">事務所・発信</div>
    ${mods('ledger') ? sideItem('#/ledger', 'grid', '写真台帳', '', '#/ledger') : ''}
    ${mods('album') ? sideItem('#/albums', 'book', '工事アルバム', 'B', '#/album') : ''}
    ${mods('writer') ? sideItem('#/writer', 'spark', '発信の下書き', 'A', '#/writer') : ''}
    ${sideItem('#/menu', 'sliders', 'メニュー・設定', '', '#/menu')}
    <button class="side__phone" data-act="phone">${icon('phone', 'lg')}<span><b>スマホで体験する</b>QRを読むと、この画面がスマホで開きます</span></button>
    <div class="side__foot">${COMPANY.name}<br>現場支援アプリ（ご提案デモ）<br>${remoteOn() ? '● スプレッドシート連携中' : '○ この端末だけで動作中'}</div>
  </aside>
  <main class="main">
    <header class="topbar">
      ${v.backTo ? `<a class="iconbtn" data-act="back" href="${v.backTo}" aria-label="戻る">${icon('back')}</a>` : `<a class="brand" href="#/" style="${v.title ? 'display:none' : ''}">${mark(32)}<span class="brand__txt"><b>${COMPANY.short}</b><span>GENBA APP</span></span></a>`}
      <div class="topbar__title">${v.title ? `<h1>${esc(v.title)}</h1>${v.sub ? `<small>${esc(v.sub)}</small>` : ''}` : ''}</div>
      ${v.actions || ''}
      <button class="iconbtn" data-act="me" aria-label="利用者を切り替え">${avatar(S.me)}</button>
    </header>
    <div id="view">${v.html || ''}</div>
  </main>
  <nav class="tabbar">${tabs.filter((t) => t[3]).map(([h, ic, l, , fab]) => fab
    ? `<a class="tab tab--fab" href="${h}"><span class="fab">${icon(ic)}</span><span>${l}</span></a>`
    : `<a class="tab ${isOn(h) ? 'on' : ''}" href="${h}">${icon(ic)}<span>${l}</span></a>`).join('')}</nav>`;
}

// 全体のクリック（利用者切替・スマホで開く）
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'me') { e.preventDefault(); pickMe(); }
  if (a.dataset.act === 'phone') { e.preventDefault(); openPhone(); }
});

export function pickMe(after) {
  sheet(`<div class="sheet__title">この端末を使う人</div><div class="sheet__sub">一度選ぶと、この端末に記憶されます。打刻や写真の撮影者に使われます。</div>
    <div class="list">${S.workers.map((w) => `<button class="li" data-w="${w.id}">${avatar(w)}<div class="li__body"><b>${esc(w.full)}</b><span>${esc(w.role)}・${esc(w.note)}</span></div>${S.me === w.id ? `<span class="check on">${icon('check')}</span>` : ''}</button>`).join('')}</div>`, {
    onOpen(el, close) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-w]'); if (!b) return;
        S.me = b.dataset.w; commit('me'); close(); toast(`${worker(S.me).full} に切り替えました`); after ? after() : rerender();
      });
    },
  });
}

export function openPhone() {
  const url = location.href;
  const local = /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname) || location.protocol === 'file:';
  sheet(`<div class="sheet__title">スマホで体験する</div>
    <div class="sheet__sub">スマホのカメラでQRを読むと、いまの画面がそのまま開きます。</div>
    <div class="qrbox">${qrSvg(url, 6)}<div class="note" style="word-break:break-all;text-align:center">${esc(url)}</div></div>
    ${local ? `<div class="note note--box" style="margin-top:12px">${icon('info')}<span>いまはこのパソコンの中だけで開いています。公開URL（GitHub Pages）で開くと、スマホからも読み取れます。</span></div>` : ''}
    <button class="btn btn--ghost btn--block" style="margin-top:14px" data-close>閉じる</button>`);
}

// ---------- ホーム ----------
function greet() { const h = new Date().getHours(); return h < 10 ? 'おはようございます' : h < 17 ? 'お疲れさまです' : 'お疲れさまでした'; }

function home() {
  const me = worker(S.me);
  const st = stateOf(S.me);
  const today = punchesOf(S.me);
  const mySite = today.length ? site(today[today.length - 1].site) : S.sites.find((s) => s.status === 'active' && s.crew.includes(S.me)) || S.sites.find((s) => s.status === 'active');
  const cur = mySite ? currentStep(mySite.id) : null;
  const nextShot = cur ? cur.shots.find((x) => !x.done) : null;
  const totalMiss = S.sites.reduce((n, s) => n + missing(s.id).length, 0);
  const todayPh = S.photos.filter((p) => isToday(p.at)).length;
  const sites = [...S.sites].sort((a, b) => ({ active: 0, plan: 1, done: 2 }[a.status] - { active: 0, plan: 1, done: 2 }[b.status]));

  let next = '';
  if (S.modules.clock && st.k === 'off') {
    next = `<a class="mod mod--hero rise d2" href="#/clock" style="--c:#2c8a5a"><span class="mod__ic">${icon('power')}</span><span><b>出勤を記録する</b><p>${mySite ? `${esc(mySite.name)}・現場に着いたら押すだけ` : '現場に着いたら押すだけ'}</p></span><span class="go">${icon('chev')}</span></a>`;
  } else if (S.modules.camera && mySite && cur && mySite.status === 'active') {
    next = `<a class="mod mod--hero rise d2" href="#/camera?site=${mySite.id}" style="--c:#ee6a1f"><span class="mod__ic">${icon('camera')}</span><span><b>次に撮る：${esc(cur.l)}${nextShot ? `「${esc(nextShot.label)}」` : ''}</b><p>${esc(mySite.name)}・${cur.shots.filter((x) => x.done).length}/${cur.shots.length} 撮影済み</p></span><span class="go">${icon('chev')}</span></a>`;
  }

  const tiles = MODULES.filter((m) => S.modules[m.k]).map((m, i) => {
    let badge = '', sub = m.d;
    if (m.k === 'camera' && totalMiss) badge = `<span class="mod__badge">${totalMiss}</span>`;
    if (m.k === 'ledger') sub = `今日 ${todayPh}枚・全 ${S.photos.length}枚`;
    if (m.k === 'clock') { const n = S.workers.filter((w) => ['work', 'break'].includes(stateOf(w.id).k)).length; sub = `いま作業中 ${n}人`; }
    return `<a class="mod rise d${(i % 6) + 1}" href="${m.href}" style="--c:${m.c}"><span class="mod__ic">${icon(m.ic)}</span>${badge || `<span class="mod__pl">${m.pl}</span>`}<b>${m.l}</b><p>${sub}</p></a>`;
  }).join('');

  const html = `<div class="page">
    <section class="hero rise">
      <svg class="hero__strokes" viewBox="0 0 130 80" aria-hidden="true"><path d="M10 18h110" stroke="#ee6a1f" stroke-width="12" stroke-linecap="round" opacity=".9"/><path d="M10 42h84" stroke="#d7262e" stroke-width="12" stroke-linecap="round" opacity=".9"/><path d="M10 66h56" stroke="#fffdf8" stroke-width="12" stroke-linecap="round" opacity=".18"/></svg>
      <div class="hero__date">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()}</div>
      <div class="hero__hello">${greet()}<small>${esc(me.full)}さん</small></div>
      <div class="wx" id="wx"><div class="wx__icon">${icon('partly')}</div><div><div class="wx__main"><span class="wx__t">--<small>℃</small></span></div><div class="wx__sub">玉名市の天気を確認中…</div></div></div>
    </section>
    ${next}
    <div class="sec"><div class="sec__head"><span class="en">FEATURES</span><h2>機能を選ぶ</h2><a class="link" href="#/menu">選び直す${icon('chev', 'sm')}</a></div>
      <div class="mods">${tiles}</div></div>
    <div class="sec"><div class="sec__head"><span class="en">SITES</span><h2>現場</h2><a class="link" href="#/sites">すべて${icon('chev', 'sm')}</a></div>
      <div class="hs">${sites.map((s, i) => siteCard(s, i)).join('')}</div></div>
    ${S.modules.clock ? `<div class="sec"><div class="sec__head"><span class="en">TEAM</span><h2>今日のチーム</h2><a class="link" href="#/clock?tab=team">出退勤${icon('chev', 'sm')}</a></div>
      <div class="list">${S.workers.filter((w) => w.role !== '協力業者').map((w) => { const s2 = stateOf(w.id); const ps = punchesOf(w.id); const f = ps[0]; return `<div class="li">${avatar(w)}<div class="li__body"><b>${esc(w.full)}</b><span>${f ? `${fmtTime(f.at)} ${f.type === 'rain' ? '雨天中止' : '出勤'}・${esc(site(f.site)?.name || '')}` : 'まだ出勤していません'}</span></div><span class="state" style="--sc:${s2.c};margin:0;background:var(--paper)"><i></i>${s2.l}</span></div>`; }).join('')}</div></div>` : ''}
    <p class="note" style="text-align:center;margin:26px 0 8px">${COMPANY.name} 現場支援アプリ（ご提案デモ）<br>写真は御社ホームページ掲載の施工写真を、工程の例として組み合わせています。</p>
  </div>`;

  return {
    html,
    mount(root) {
      weather().then((w) => {
        const el = root.querySelector('#wx'); if (!el) return;
        const j = paintJudge(w);
        el.innerHTML = `<div class="wx__icon">${icon(wxIcon(w.code))}</div>
          <div><div class="wx__main"><span class="wx__t">${w.t}<small>℃</small></span><span class="wx__sub">${icon('drop', 'sm')} 湿度 ${w.h}%　${icon('wind', 'sm')} ${w.wind}m/s<br>${wxLabel(w.code)}・玉名市${w.live ? '' : '（デモ値）'}</span></div></div>
          <div class="wx__judge"><span class="judge judge--${j.cls}"><i></i>今日の塗装　${j.l}</span><span style="opacity:.7;font-size:12px">${esc(j.why || '')}</span></div>`;
      });
    },
  };
}

// ---------- 現場一覧 ----------
function sitesView() {
  const groups = [['active', '施工中'], ['plan', '着工予定'], ['done', '完了']];
  return {
    title: '現場一覧', sub: `${S.sites.length}現場`, backTo: '#/',
    actions: `<button class="iconbtn iconbtn--ink" data-x="new" aria-label="現場を登録">${icon('plus')}</button>`,
    html: `<div class="page page--wide">
      ${groups.map(([k, l]) => { const list = S.sites.filter((s) => s.status === k); return list.length ? `<div class="sec"><div class="sec__head"><h2>${l}</h2><span class="muted" style="font-size:12px">${list.length}</span></div>
        <div class="hs" style="flex-wrap:wrap;margin:0;padding:0">${list.map((s, i) => siteCard(s, i).replace('class="sitecard', 'style="flex:1 1 300px;max-width:none" class="sitecard')).join('')}</div></div>` : ''; }).join('')}
      <button class="btn btn--primary btn--block" style="margin-top:22px" data-x="new">${icon('plus')}現場を登録してQRを発行</button>
    </div>`,
    mount(root) {
      const h = (e) => { if (e.target.closest('[data-x="new"]')) newSite(); };
      document.addEventListener('click', h);
      return () => document.removeEventListener('click', h);
    },
  };
}

function newSite() {
  const n = Math.max(...S.sites.map((s) => Number(s.id.slice(1)) || 0)) + 1;
  const id = `N${String(n).padStart(3, '0')}`;
  sheet(`<div class="sheet__title">現場を登録する</div><div class="sheet__sub">登録すると、工程ごとのフォルダと、この現場専用のQRができます。</div>
    <div class="stack">
      <div class="field"><label>現場名</label><input class="input" id="ns-name" placeholder="例）玉名市 K様邸" value="玉名市 K様邸"></div>
      <div class="note note--box">${icon('shield')}<span>お客様のお名前は「K様邸」の形にします。ファイル名にも実名は入りません。</span></div>
      <div class="field"><label>工事の種類（工程ボタンが切り替わります）</label>
        <div class="chips" id="ns-kind">${Object.entries(KINDS).map(([k, v], i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-k="${k}">${esc(v.label)}</button>`).join('')}</div></div>
      <div class="grid2"><div class="field"><label>市町村</label><input class="input" id="ns-place" value="玉名市"></div>
      <div class="field"><label>着工予定日</label><input class="input" id="ns-start" type="date" value="${dkey(new Date(Date.now() + 3 * 864e5))}"></div></div>
      <button class="btn btn--primary btn--block" id="ns-go">${icon('qr')}登録してQRを発行する</button>
    </div>`, {
    onOpen(el, close) {
      let kind = 'wall';
      el.querySelector('#ns-kind').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; el.querySelectorAll('#ns-kind .chip').forEach((c) => c.classList.toggle('on', c === b)); });
      el.querySelector('#ns-go').addEventListener('click', () => {
        const name = el.querySelector('#ns-name').value.trim() || `新しい現場 ${id}`;
        const s = { id, name, place: el.querySelector('#ns-place').value.trim(), kind, title: KINDS[kind].label, status: 'plan', start: el.querySelector('#ns-start').value, end: '', token: Math.random().toString(36).slice(2, 12), crew: [S.me === 'w4' ? 'w1' : S.me], lat: COMPANY.lat, lng: COMPANY.lng, cover: '', paint: {}, memo: '', created: new Date().toISOString() };
        S.sites.push(s); commit('site');
        if (remoteOn()) import('./store.js').then((m) => m.enqueue('addSite', { site: s }));
        close(); toast(`${id} を登録しました。工程フォルダを作成しました`);
        setTimeout(() => showQr(s.id), 380);
      });
    },
  });
}

export function campUrl(s) { return `${location.origin}${location.pathname}#/camera?site=${s.id}`; }
export function albumUrl(s) { return `${location.origin}${location.pathname}#/album/${s.token}`; }

export function showQr(id) {
  const s = site(id);
  sheet(`<div class="sheet__title">現場に貼るQR</div><div class="sheet__sub">足場や車に貼っておけば、読むだけでこの現場の撮影画面が開きます。現場を選ぶ操作はありません。</div>
    <div style="display:grid;justify-items:center">
      <div class="qrsticker"><div class="qrsticker__head">${mark(22)}<b>${COMPANY.short}　現場写真</b></div>
        <div class="qrsticker__body">${qrSvg(campUrl(s), 4)}<div><small class="en" style="letter-spacing:.2em">${s.id}</small><b>${esc(s.name)}</b><small>${esc(s.title)}</small><small style="margin-top:6px">① QRを読む ② 工程を押す ③ 撮って送る</small></div></div>
        <div class="qrsticker__foot">撮った写真は、自動で工程ごとに整理されます</div></div>
    </div>
    <div class="grid2" style="margin-top:16px"><a class="btn btn--ghost" href="#/camera?site=${s.id}" data-close>${icon('camera')}撮影を開く</a><button class="btn btn--ink" onclick="window.print()">${icon('download')}印刷する</button></div>`);
}

// ---------- 現場の詳細 ----------
function siteView(q, id) {
  const s = site(id);
  if (!s) return { title: '現場が見つかりません', backTo: '#/sites', html: '<div class="page"><div class="empty">この現場は登録されていません。</div></div>' };
  const ph = photosOf(id);
  const cover = s.status === 'done' ? imgSrc(ph.filter((p) => p.step === 'done')[0] || ph[ph.length - 1], 'f') : (s.cover || (ph.length ? imgSrc(ph[ph.length - 1], 'f') : ''));
  const cl = checklist(id); const cur = s.status === 'active' ? currentStep(id) : null;
  const miss = missing(id);
  const k = kindOf(s);
  // 乾燥時間の目安（塗り重ねの間隔）
  let dry = '';
  const coatSteps = k.steps.filter((x) => x.next);
  for (const st of coatSteps) {
    const last = ph.filter((p) => p.step === st.k).slice(-1)[0];
    if (!last || s.status !== 'active') continue;
    const ready = new Date(last.at).getTime() + st.next * 3600e3;
    const nextSt = k.steps[k.steps.findIndex((x) => x.k === st.k) + 1];
    if (ph.some((p) => p.step === nextSt.k)) continue;
    const left = ready - Date.now();
    const lm = Math.ceil(left / 60000);
    dry = `<div class="alert ${left > 0 ? 'alert--info' : 'alert--ok'}">${icon('timer')}<div><b>${left > 0 ? `${nextSt.l}まで あと ${Math.floor(lm / 60) ? `${Math.floor(lm / 60)}時間` : ''}${lm % 60}分` : `${nextSt.l}に進めます`}</b>${st.l}の最後の写真 ${fmtTime(last.at)}・乾燥の目安 ${st.next}時間（気温・塗料の仕様で変わります）</div></div>`;
  }
  const html = `<div class="page page--wide">
    <div class="sitehero rise" style="background-image:url('${cover || ''}')"><div class="sitehero__in">
      <div class="row" style="gap:6px"><span class="tag tag--ink en">${s.id}</span>${{ active: '<span class="tag tag--o">施工中</span>', done: '<span class="tag tag--g">完了</span>', plan: '<span class="tag">着工予定</span>' }[s.status]}${s.public ? '<span class="tag tag--b">公共工事</span>' : ''}</div>
      <h2>${esc(s.name)}</h2><p>${esc(s.title)}・${fmtDate(s.start, false)}〜${s.end ? fmtDate(s.end, false) : ''}</p></div></div>

    <div class="grid2" style="margin-top:14px">
      ${S.modules.camera ? `<a class="btn btn--primary" href="#/camera?site=${s.id}">${icon('camera')}撮影する</a>` : ''}
      <button class="btn btn--ghost" data-x="qr">${icon('qr')}現場のQR</button>
      ${S.modules.album ? `<a class="btn btn--ghost" href="#/album/${s.token}?from=app">${icon('book')}アルバム</a>` : ''}
      ${S.modules.writer ? `<a class="btn btn--ghost" href="#/writer?site=${s.id}">${icon('spark')}発信</a>` : ''}
    </div>

    ${s.public ? `<div class="note note--box" style="margin-top:14px">${icon('info')}<span><b>公共工事の写真について：</b>発注者へ提出する工事写真は、改ざん検知に対応した電子小黒板アプリで撮影します。このアプリは撮影計画・撮り漏れの確認と、社内共有・広報用（発注者の許可が出たもの）に使います。</span></div>` : ''}

    <div class="dash" style="margin-top:14px">
      <div class="card card__pad w6">
        <div class="row row--between"><h2 style="font-size:15px;letter-spacing:.08em">工程の進み具合</h2><span class="num" style="font-size:26px">${Math.round(progress(id) * 100)}<small style="font-size:14px">%</small></span></div>
        ${stepperHtml(id)}
        ${dry ? `<div style="margin-top:12px">${dry}</div>` : ''}
        ${miss.length ? `<div class="alert" style="margin-top:12px">${icon('alert')}<div><b>撮り漏れが ${miss.length}件あります</b>${miss.slice(0, 3).map((m) => `${esc(m.step.l)}「${esc(m.shot.label)}」`).join('、')}${miss.length > 3 ? ' ほか' : ''}</div></div>` : ''}
      </div>
      <div class="card card__pad w6">
        <div class="row row--between"><h2 style="font-size:15px;letter-spacing:.08em">3回塗りの記録</h2>${coatHtml(id)}</div>
        <p class="note" style="margin:6px 0 12px">${k.coatParts.length > 1 ? '部位ごとに、下塗り・中塗り・上塗りの写真が揃っているかを3本の線で表します。' : '各層の写真が揃っているかを3本の線で表します。'}</p>
        ${coatHtml(id, true)}
      </div>
      <div class="w12">
        <div class="sec__head" style="margin-top:6px"><span class="en">CHECKLIST</span><h2>撮るものリスト</h2><span class="muted" style="font-size:12px;margin-left:auto">${cl.reduce((n, x) => n + x.shots.filter((y) => y.done).length, 0)} / ${cl.reduce((n, x) => n + x.shots.length, 0)}</span></div>
        <div class="list stepsList">${cl.map((st, i) => {
          const cls = st.done ? 'done' : cur && st.k === cur.k ? 'now' : '';
          return `<a class="li" href="${S.modules.camera && s.status !== 'done' ? `#/camera?site=${s.id}&step=${st.k}` : `#/ledger?site=${s.id}&step=${st.k}`}"><span class="stepnum ${cls}">${String(i + 1).padStart(2, '0')}</span>
            <div class="li__body"><b>${esc(st.l)} ${cur && st.k === cur.k ? '<span class="tag tag--o">いまここ</span>' : ''}</b><span>${st.shots.map((x) => `${x.done ? '✓' : '・'}${esc(x.label)}`).join('　')}</span></div>
            <span class="li__end">${st.count ? `<span class="num" style="font-size:18px">${st.count}</span><span class="muted" style="font-size:11px">枚</span>` : ''}</span>${icon('chev', 'sm chev')}</a>`;
        }).join('')}</div>
      </div>
      <div class="w12">
        <div class="sec__head"><span class="en">PHOTOS</span><h2>最近の写真</h2><a class="link" href="#/ledger?site=${s.id}">台帳で見る${icon('chev', 'sm')}</a></div>
        ${ph.length ? `<div class="ph-grid">${ph.slice(-12).reverse().map((p) => `<a class="ph" href="#/ledger?site=${s.id}&open=${p.id}">${imgTag(p)}<span class="ph__lbl">${esc(k.steps.find((x) => x.k === p.step)?.l || '')}</span></a>`).join('')}</div>` : `<div class="empty card">${icon('image')}<p>まだ写真がありません。<br>現場のQRを読んで、最初の「着工前」を撮りましょう。</p></div>`}
      </div>
      <div class="card card__pad w12">
        <h2 style="font-size:15px;letter-spacing:.08em;margin-bottom:8px">現場の情報</h2>
        <dl class="spec" style="margin-top:0">
          <dt>工事の種類</dt><dd>${esc(k.label)}</dd>
          <dt>担当</dt><dd><div class="row">${s.crew.map((w) => `${avatar(w)}<span style="font-size:13px">${esc(worker(w).full)}</span>`).join('')}</div></dd>
          ${Object.entries(s.paint || {}).map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}
          <dt>メモ</dt><dd>${esc(s.memo || '—')}</dd>
          <dt>お客様URL</dt><dd style="word-break:break-all;font-size:12px">${esc(albumUrl(s))}</dd>
        </dl>
      </div>
    </div>
  </div>`;
  return {
    title: s.name, sub: `${s.id}・${k.label}`, backTo: '#/sites', html, wide: true,
    mount(root) {
      root.addEventListener('click', (e) => { if (e.target.closest('[data-x="qr"]')) showQr(s.id); });
    },
  };
}

// ---------- メニュー・設定 ----------
function menuView() {
  const modsHtml = MODULES.map((m) => `<label class="li" style="cursor:pointer"><span class="li__ic" style="background:${m.c};color:#fff">${icon(m.ic, 'sm')}</span><div class="li__body"><b>${m.l} <span class="tag" style="margin-left:4px">${m.pl}</span></b><span>${m.d}</span></div><span class="switch"><input type="checkbox" data-mod="${m.k}" ${S.modules[m.k] ? 'checked' : ''}><span></span></span></label>`).join('');
  const html = `<div class="page">
    <div class="sec" style="margin-top:6px"><div class="sec__head"><span class="en">FEATURES</span><h2>使う機能を選ぶ</h2></div>
      <p class="note" style="margin:-4px 2px 10px">必要な機能だけを選んで導入できます。OFFにした機能は、ホームとメニューから消えます。</p>
      <div class="list">${modsHtml}</div></div>
    <div class="sec"><div class="sec__head"><span class="en">USER</span><h2>この端末を使う人</h2></div>
      <div class="list"><button class="li" data-act="me">${avatar(S.me)}<div class="li__body"><b>${esc(worker(S.me).full)}</b><span>タップして切り替え</span></div>${icon('chev', 'sm chev')}</button></div></div>
    <div class="sec"><div class="sec__head"><span class="en">LINK</span><h2>スプレッドシート連携</h2><span class="demo-badge ${remoteOn() ? 'live' : ''}" style="margin-left:auto"><i></i>${remoteOn() ? 'LIVE' : 'LOCAL'}</span></div>
      <div class="card card__pad stack">
        <p class="note">GoogleのスプレッドシートとドライブにつなぐとPC・スマホ・事務所で同じデータを見られます。スマホで撮った写真が、数秒でパソコンの台帳に出ます。</p>
        <div class="field"><label>GASのURL（…/exec）</label><input class="input" id="gas-url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(S.settings.gasUrl)}"></div>
        <div class="field"><label>合言葉</label><input class="input" id="gas-key" value="${esc(S.settings.gasKey)}" placeholder="スクリプトプロパティの APP_KEY"></div>
        <div class="grid2"><button class="btn btn--ink" data-x="gas-save">${icon('link')}接続する</button><button class="btn btn--ghost" data-x="gas-off">切断</button></div>
        ${S.queue.length ? `<div class="alert alert--info">${icon('cloudUp')}<div><b>送信待ち ${S.queue.length}件</b>電波が戻ると自動で送ります。</div></div>` : ''}
      </div></div>
    <div class="sec"><div class="sec__head"><span class="en">DEMO</span><h2>デモの設定</h2></div>
      <div class="list">
        <label class="li" style="cursor:pointer"><span class="li__ic">${icon('pin', 'sm')}</span><div class="li__body"><b>位置情報はデモの値を使う</b><span>ONなら、どこにいても「現場から○m」と表示します</span></div><span class="switch"><input type="checkbox" data-set="demoGeo" ${S.settings.demoGeo ? 'checked' : ''}><span></span></span></label>
        <button class="li" data-act="phone"><span class="li__ic">${icon('phone', 'sm')}</span><div class="li__body"><b>スマホで開く</b><span>この画面のQRを表示します</span></div>${icon('chev', 'sm chev')}</button>
        <button class="li" data-x="reset"><span class="li__ic" style="color:var(--red)">${icon('refresh', 'sm')}</span><div class="li__body"><b>デモを最初の状態に戻す</b><span>撮影した写真・打刻を消して、見本のデータに戻します</span></div></button>
      </div></div>
    <div class="sec"><div class="sec__head"><span class="en">ABOUT</span><h2>このアプリについて</h2></div>
      <div class="card card__pad" style="font-size:13px;line-height:1.9">
        <b>${COMPANY.name} 現場支援アプリ</b>（ご提案デモ）<br>
        ・出退勤：工場向け勤怠管理（模擬案件5）を、直行直帰の塗装現場に合わせて作り替え<br>
        ・現場写真・写真台帳：工務店向け現場写真管理（模擬案件4）を、塗装・防水の工程に合わせて作り替え<br>
        ・発信の下書き＝ご提案書 PLAN A／工事アルバム＝PLAN B／ダッシュボードと口コミ＝PLAN C<br>
        <span class="muted">文章の自動作成はデモでは定型の組み立てです。本番は生成AI（Gemini）で御社の言葉づかいに合わせて作ります。</span>
      </div></div>
    <p class="note" style="text-align:center;margin:24px 0">Designed &amp; built by TATSUYA STYLE</p>
  </div>`;
  return {
    title: 'メニュー', sub: '機能の選択・設定', backTo: '#/', html,
    mount(root) {
      root.addEventListener('change', (e) => {
        const m = e.target.dataset.mod; const st = e.target.dataset.set;
        if (m) { S.modules[m] = e.target.checked; commit('mods'); toast(`${MODULES.find((x) => x.k === m).l}を${e.target.checked ? '使う' : '使わない'}にしました`); setTimeout(() => rerender(), 200); }
        if (st) { S.settings[st] = e.target.checked; commit('set'); }
      });
      root.addEventListener('click', async (e) => {
        const x = e.target.closest('[data-x]'); if (!x) return;
        if (x.dataset.x === 'reset') {
          if (!confirm('撮影した写真や打刻を消して、デモを最初の状態に戻します。よろしいですか？')) return;
          await resetAll(); toast('デモを最初の状態に戻しました'); go('#/');
        }
        if (x.dataset.x === 'gas-save') {
          const url = root.querySelector('#gas-url').value.trim(); const key = root.querySelector('#gas-key').value.trim();
          if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) { toast('URLは …/exec で終わる形で入れてください', 'warn'); return; }
          try {
            const r = await gasTest(url, key);
            if (!r.ok) throw new Error(r.error);
            S.settings.gasUrl = url; S.settings.gasKey = key; commit('gas');
            await pull(); flush(); toast(`つながりました（${r.sheet || 'スプレッドシート'}）`); rerender();
          } catch (err) { toast('つながりませんでした。URLと合言葉を確認してください', 'warn'); }
        }
        if (x.dataset.x === 'gas-off') { S.settings.gasUrl = ''; commit('gas'); toast('この端末だけで動くようにしました'); rerender(); }
      });
    },
  };
}

// ---------- 起動 ----------
async function boot() {
  await init();
  window.addEventListener('hashchange', () => {
    const prev = lastHash; lastHash = location.hash;
    const base = (h) => (h || '#/').split('?')[0].split('/')[1] || '';
    if (base(prev) !== base(location.hash) && !document.body.classList.contains('full')) {
      const m = MODULES.find((x) => location.hash.startsWith(x.href));
      swipe(m ? m.c : '#111317');
      setTimeout(() => render(), 170);
    } else render();
  });
  onChange((why) => { if ((why === 'pull' || why === 'sync') && current && current.live) rerender(); });
  lastHash = location.hash;
  render();
  setTimeout(() => document.querySelector('.boot')?.classList.add('out'), 380);
  // 連携中は、ほかの端末の写真や打刻を定期的に取り込む
  setInterval(() => { if (remoteOn() && document.visibilityState === 'visible') { pull(); flush(); } }, 6000);
  window.addEventListener('online', () => flush());
  if (remoteOn()) { pull(); flush(); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
