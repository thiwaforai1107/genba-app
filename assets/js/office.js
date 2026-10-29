// 事務所の画面：写真台帳（検索）と、社長ダッシュボード
import { icon } from './icons.js';
import { MONTHLY, KINDS } from './data.js';
import {
  S, commit, esc, worker, site, kindOf, stepOf, photosOf, imgTag, imgSrc, hydrate, fileName, fmtDate, fmtTime, fmtYmd,
  dkey, isToday, ago, stateOf, punchesOf, missing, currentStep, progress, weather, paintJudge, wxIcon, wxLabel,
  remoteOn, enqueue,
} from './store.js';
import { toast, sheet, baHtml, bindBA } from './ui.js';
import { avatar, go, rerender, stepperHtml, coatHtml } from './app.js';

// ---------- 写真台帳 ----------
export function ledgerView(q) {
  const t0 = performance.now();
  const f = { site: q.site || '', step: q.step || '', part: q.part || '', by: q.by || '', period: q.period || 'all' };
  const s = f.site ? site(f.site) : null;
  const now = new Date();
  const since = { all: 0, today: new Date(dkey()).getTime(), week: now - 7 * 864e5, month: now - 31 * 864e5 }[f.period] || 0;
  let list = S.photos.filter((p) => (!f.site || p.site === f.site) && (!f.step || p.step === f.step) && (!f.part || p.part === f.part) && (!f.by || p.by === f.by) && new Date(p.at).getTime() >= since);
  list.sort((a, b) => new Date(b.at) - new Date(a.at));
  const ms = Math.max(0.1, performance.now() - t0).toFixed(1);
  const link = (patch) => { const n = { ...f, ...patch }; const qs = Object.entries(n).filter(([k, v]) => v && !(k === 'period' && v === 'all')).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); return `#/ledger${qs ? '?' + qs : ''}`; };

  const steps = s ? kindOf(s).steps : KINDS.wall.steps;
  const parts = s ? kindOf(s).parts : [...new Set(S.photos.map((p) => p.part))];
  const groups = {};
  list.forEach((p) => { const d = dkey(p.at); (groups[d] = groups[d] || []).push(p); });

  const chip = (on, href, label, extra = '') => `<a class="chip ${on ? 'on' : ''}" href="${href}">${extra}${label}</a>`;
  const html = `<div class="page page--wide">
    <div class="card card__pad" style="padding:14px 16px">
      <div class="chips chips--scroll" style="margin-top:0">${chip(!f.site, link({ site: '', step: '', part: '' }), 'すべての現場')}${S.sites.map((x) => chip(f.site === x.id, link({ site: x.id, step: '', part: '' }), esc(x.name), `<span class="en" style="opacity:.55">${x.id}</span> `)).join('')}</div>
      <div class="chips chips--scroll">${chip(!f.step, link({ step: '' }), '全工程')}${steps.map((x) => chip(f.step === x.k, link({ step: x.k }), esc(x.l), `<span class="dot" style="background:${x.c}"></span>`)).join('')}</div>
      <div class="chips chips--scroll">${chip(!f.part, link({ part: '' }), '全部位')}${parts.map((x) => chip(f.part === x, link({ part: x }), esc(x))).join('')}
        <span style="width:1px;background:var(--line-2);margin:4px 4px;flex:none"></span>
        ${chip(!f.by, link({ by: '' }), '全員')}${S.workers.filter((w) => S.photos.some((p) => p.by === w.id)).map((w) => chip(f.by === w.id, link({ by: w.id }), esc(w.name), '')).join('')}</div>
      <div class="row row--between" style="margin-top:8px;flex-wrap:wrap;gap:10px">
        <div class="seg" style="flex:1 1 280px;max-width:420px">${[['all', 'すべて'], ['today', '今日'], ['week', '7日'], ['month', '1か月']].map(([k, l]) => `<a href="${link({ period: k })}" style="display:grid"><button class="${f.period === k ? 'on' : ''}" tabindex="-1">${l}</button></a>`).join('')}</div>
        <div style="font-size:13px"><b class="num" style="font-size:24px" data-count="${list.length}">${list.length}</b> 枚<span class="muted">／全 ${S.photos.length}枚　検索 ${ms}ms</span></div>
      </div>
    </div>
    ${list.length ? Object.entries(groups).map(([d, ps]) => `<div class="daygrp"><h3>${fmtDate(d)}<small>${ps.length}枚${isToday(d) ? '・今日' : ''}</small></h3>
      <div class="ph-grid">${ps.map((p) => { const st = stepOf(site(p.site), p.step); return `<button class="ph" data-open="${p.id}">${imgTag(p)}<span class="ph__lbl">${esc(st ? st.l : '')}・${esc(p.part)}</span>${p.flags?.post ? `<span class="ph__star">${icon('star')}</span>` : ''}${isToday(p.at) && !p.seed ? '<span class="ph__new">NEW</span>' : ''}${p.pending ? '<span class="ph__pend">送信待ち</span>' : ''}</button>`; }).join('')}</div></div>`).join('')
      : `<div class="empty card" style="margin-top:14px">${icon('image')}<p>この条件の写真はありません。</p></div>`}
  </div>`;
  return {
    title: '写真台帳', sub: s ? `${s.name}` : '現場・工程・部位で探す', backTo: s ? `#/site/${s.id}` : '#/', html, live: true,
    mount(root) {
      root.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openViewer(b.dataset.open, list); });
      if (q.open) setTimeout(() => openViewer(q.open, list), 50);
    },
  };
}

export function openViewer(id, list) {
  list = list && list.length ? list : S.photos;
  let i = Math.max(0, list.findIndex((p) => p.id === id));
  const v = document.createElement('div'); v.className = 'viewer';
  document.body.appendChild(v);
  const draw = () => {
    const p = list[i]; const s = site(p.site); const st = stepOf(s, p.step); const w = worker(p.by);
    const k = kindOf(s);
    const beforeSt = k.steps[0];
    const before = p.step !== beforeSt.k ? photosOf(p.site).find((x) => x.step === beforeSt.k && (x.part === p.part || x.shot === 0)) : null;
    v.innerHTML = `<div class="viewer__top"><button class="iconbtn" data-v="close" aria-label="閉じる">${icon('close')}</button>
        <div style="flex:1;min-width:0"><b style="display:block;font-size:14px">${esc(s.name)}</b><span style="font-size:11.5px;opacity:.6">${i + 1} / ${list.length}</span></div>
        <button class="iconbtn" data-v="prev" aria-label="前へ">${icon('back')}</button><button class="iconbtn" data-v="next" aria-label="次へ">${icon('chev')}</button></div>
      <div class="viewer__img">${imgTag(p, 'f')}</div>
      <div class="viewer__meta">
        <div class="tags"><span class="tag" style="background:${st ? st.c : '#555'}">${esc(st ? st.l : p.step)}</span><span class="tag">${esc(st && st.shots[p.shot] ? st.shots[p.shot][0] : '')}</span><span class="tag">${esc(p.part)}</span>${p.flags?.album ? '<span class="tag">アルバム掲載</span>' : '<span class="tag">社内のみ</span>'}</div>
        <div class="row" style="margin-top:12px">${avatar(w)}<div><b style="font-size:14px">${esc(w.full)}</b><div style="font-size:12px;opacity:.65">${fmtYmd(p.at)} ${fmtTime(p.at)}・${p.wx ? `${wxLabel(p.wx.code)} ${p.wx.t}℃ ${p.wx.h}%` : ''}</div></div></div>
        ${p.note ? `<p style="margin-top:10px;font-size:13.5px">「${esc(p.note)}」</p>` : ''}
        <div class="fn">${esc(fileName(p))}</div>
        <div class="viewer__acts">
          <button class="btn ${p.flags?.album ? 'on' : ''}" data-v="album">${icon('book', 'sm')}${p.flags?.album ? 'アルバムに掲載中' : 'アルバムに載せる'}</button>
          <button class="btn ${p.flags?.post ? 'on' : ''}" data-v="post">${icon('star', 'sm')}${p.flags?.post ? '発信に使う' : '発信に使う？'}</button>
          ${before ? `<button class="btn" data-v="ba">${icon('compare', 'sm')}着工前と比べる</button>` : ''}
        </div>
      </div>`;
    hydrate(v);
  };
  draw();
  const setFlag = (k) => {
    const p = list[i]; p.flags = p.flags || {}; p.flags[k] = !p.flags[k]; commit('flags');
    if (remoteOn()) enqueue('updatePhoto', { id: p.id, flags: p.flags });
    toast(k === 'album' ? (p.flags.album ? 'お客様のアルバムに載せました' : 'アルバムから外しました（社内のみ）') : (p.flags.post ? '発信の候補にしました' : '発信の候補から外しました'));
    draw();
  };
  const close = () => { v.remove(); window.removeEventListener('keydown', key); rerender(); };
  const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') { i = (i + 1) % list.length; draw(); } if (e.key === 'ArrowLeft') { i = (i - 1 + list.length) % list.length; draw(); } };
  window.addEventListener('keydown', key);
  let x0 = null;
  v.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  v.addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) { i = (i + (dx < 0 ? 1 : -1) + list.length) % list.length; draw(); } });
  v.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    const a = b.dataset.v;
    if (a === 'close') close();
    if (a === 'next') { i = (i + 1) % list.length; draw(); }
    if (a === 'prev') { i = (i - 1 + list.length) % list.length; draw(); }
    if (a === 'album') setFlag('album');
    if (a === 'post') setFlag('post');
    if (a === 'ba') {
      const p = list[i]; const k = kindOf(site(p.site));
      const before = photosOf(p.site).find((x) => x.step === k.steps[0].k && (x.part === p.part || x.shot === 0));
      sheet(`<div class="sheet__title">着工前と比べる</div><div class="sheet__sub">つまみを左右に動かすと、同じ場所の変化が分かります。</div>
        ${baHtml(imgSrc(before, 'f'), imgSrc(p, 'f'), '着工前', stepOf(site(p.site), p.step).l)}
        <button class="btn btn--ghost btn--block" style="margin-top:14px" data-close>閉じる</button>`, { onOpen(el) { hydrate(el); bindBA(el); } });
    }
  });
}

// ---------- 社長ダッシュボード ----------
export function dashView() {
  const active = S.sites.filter((s) => s.status === 'active');
  const crew = S.workers.filter((w) => w.role !== '協力業者');
  const working = crew.filter((w) => ['work', 'break'].includes(stateOf(w.id).k)).length;
  const todayPh = S.photos.filter((p) => isToday(p.at));
  const miss = S.sites.flatMap((s) => missing(s.id).map((m) => ({ ...m, s })));
  const reports = [...S.reports].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 4);
  const draftsReady = Object.values(S.drafts).filter((d) => d && !d.posted).length;
  const reviews = S.reviews.length;

  const html = `<div class="page page--wide">
    <div class="row row--between" style="margin:2px 2px 14px;flex-wrap:wrap;gap:8px">
      <div><div class="eyebrow">TODAY</div><div style="font-size:20px;font-weight:700;letter-spacing:.06em;margin-top:4px">${fmtDate(new Date())}　現場の状況</div></div>
      <span class="demo-badge ${remoteOn() ? 'live' : ''}"><i></i>${remoteOn() ? 'LIVE・スプレッドシート連携' : 'DEMO・この端末のデータ'}</span>
    </div>
    <div class="dash">
      <div class="w12 kpis">
        <div class="kpi rise d1" style="--k:#2c8a5a"><small>${icon('users', 'sm')}現場に出ている</small><b><span data-count="${working}">0</span><small> / ${crew.length}人</small></b></div>
        <div class="kpi rise d2" style="--k:#ee6a1f"><small>${icon('building', 'sm')}施工中の現場</small><b><span data-count="${active.length}">0</span><small> 現場</small></b></div>
        <div class="kpi rise d3" style="--k:#2a6f97"><small>${icon('camera', 'sm')}今日の写真</small><b><span data-count="${todayPh.length}">0</span><small> 枚</small></b></div>
        <div class="kpi rise d4 ${miss.length ? 'kpi--alert' : ''}" style="--k:${miss.length ? '#d7262e' : '#2c8a5a'}"><small>${icon('alert', 'sm')}撮り漏れ</small><b><span data-count="${miss.length}">0</span><small> 件</small></b></div>
      </div>

      <div class="card w8">
        <div class="card__head"><h2>施工中の現場</h2><a class="link" href="#/sites">一覧${icon('chev', 'sm')}</a></div>
        <div style="padding:6px 18px 18px">${active.map((s) => {
          const cur = currentStep(s.id); const ph = photosOf(s.id); const tp = ph.filter((p) => isToday(p.at));
          return `<a href="#/site/${s.id}" style="display:block;padding:12px 0;border-bottom:1px solid var(--line)">
            <div class="row row--between"><div><b style="font-size:15px">${esc(s.name)}</b> <span class="muted" style="font-size:12px">${s.id}・${esc(s.title)}</span></div><div class="avatars">${s.crew.map((w) => avatar(w)).join('')}</div></div>
            ${stepperHtml(s.id)}
            <div class="row" style="gap:6px;margin-top:8px;overflow:hidden">${tp.slice(-6).map((p) => `<span style="width:56px;height:56px;border-radius:8px;overflow:hidden;flex:none;display:block">${imgTag(p, 't', 'style="width:100%;height:100%;object-fit:cover"')}</span>`).join('') || '<span class="muted" style="font-size:12px">今日の写真はまだありません</span>'}
              ${tp.length ? `<span class="muted" style="font-size:12px;margin-left:6px">今日 ${tp.length}枚・最新 ${ago(tp[tp.length - 1].at)}</span>` : ''}</div>
            <div class="row" style="margin-top:8px;gap:10px"><span class="muted" style="font-size:12px">3回塗り</span>${coatHtml(s.id)}<span class="muted" style="font-size:12px">いま：${esc(cur.l)}</span></div>
          </a>`;
        }).join('') || '<p class="muted" style="padding:12px 0">施工中の現場はありません。</p>'}</div>
      </div>

      <div class="w4" style="display:grid;gap:14px;align-content:start">
        <div class="hero" id="d-wx" style="padding:18px"><div class="hero__date">PAINTING CONDITION</div><div class="hero__hello" style="font-size:17px">今日の塗装条件</div><div class="wx__sub" style="margin-top:8px">確認中…</div></div>
        <div class="card card__pad">
          <h2 style="font-size:15px;letter-spacing:.08em;margin-bottom:10px">気になること</h2>
          <div class="stack">${miss.slice(0, 3).map((m) => `<a class="alert" href="#/camera?site=${m.s.id}&step=${m.step.k}">${icon('camera')}<div><b>${esc(m.s.name)}</b>${esc(m.step.l)}「${esc(m.shot.label)}」が未撮影</div></a>`).join('')}
            ${crew.filter((w) => stateOf(w.id).k === 'off').map((w) => `<div class="alert alert--info">${icon('clock')}<div><b>${esc(w.full)}</b>まだ出勤の記録がありません</div></div>`).join('')}
            ${miss.length > 3 ? `<a class="link" href="#/site/${miss[0].s.id}" style="font-size:12.5px;font-weight:700;color:var(--orange)">ほか ${miss.length - 3}件を現場で見る</a>` : ''}
            ${!miss.length ? `<div class="alert alert--ok">${icon('check')}<div><b>撮り漏れはありません</b>すべての工程の写真が揃っています</div></div>` : ''}</div>
        </div>
      </div>

      <div class="card w6">
        <div class="card__head"><h2>今日の出退勤</h2><a class="link" href="#/clock?tab=team">詳しく${icon('chev', 'sm')}</a></div>
        <div style="padding:8px 8px 10px">${crew.map((w) => { const st = stateOf(w.id); const ps = punchesOf(w.id); const fi = ps.find((p) => ['in', 'rain'].includes(p.type)); return `<div class="li" style="min-height:52px">${avatar(w)}<div class="li__body"><b>${esc(w.full)}</b><span>${fi ? `${fmtTime(fi.at)}〜　${esc(site(fi.site)?.name || '')}${fi.geo ? `（現場から${fi.geo}m）` : ''}` : '—'}</span></div><span class="state" style="--sc:${st.c};margin:0;background:var(--paper);font-size:11.5px"><i></i>${st.l}</span></div>`; }).join('')}</div>
      </div>

      <div class="card w6">
        <div class="card__head"><h2>職人さんの日報</h2></div>
        <div style="padding:8px 8px 10px">${reports.map((r) => `<div class="li" style="align-items:flex-start">${avatar(r.w)}<div class="li__body"><b>${esc(worker(r.w).full)}<span class="muted" style="font-weight:500;font-size:12px">　${fmtDate(r.date, false)}・${esc(site(r.site)?.name || '')}</span></b><span style="color:var(--text);font-size:13px;margin-top:2px">${r.works.map((x) => `<span class="tag" style="margin-right:4px">${esc(x)}</span>`).join('')}${esc(r.note)}</span></div></div>`).join('') || '<p class="muted" style="padding:10px">まだ日報はありません。</p>'}</div>
      </div>

      <div class="card w8">
        <div class="card__head"><h2>月次レポート</h2><span class="tag tag--a" style="margin-left:6px">導入後のイメージ・デモ値</span></div>
        <div style="padding:6px 18px 18px">${monthlyChart()}
          <div class="legend" style="margin-top:8px"><span><i style="background:#ee6a1f"></i>お問い合わせ</span><span><i style="background:#2a6f97"></i>口コミ</span><span><i style="background:#2c8a5a"></i>求人の応募</span><span><i style="background:#111317;height:3px;border-radius:2px"></i>発信の数</span></div>
          <p class="note" style="margin-top:10px">写真から発信の下書きが自動でそろうようになると、発信の数が増え、問い合わせ・口コミ・応募にどう効いたかを毎月この1枚で振り返ります（ご提案書 PLAN C）。</p></div>
      </div>

      <div class="w4" style="display:grid;gap:14px;align-content:start">
        <a class="card card__pad" href="#/writer" style="display:block"><div class="row row--between"><h2 style="font-size:15px;letter-spacing:.08em">発信の下書き</h2>${icon('chev', 'sm')}</div>
          <div class="row" style="gap:18px;margin-top:10px"><div><span class="num" style="font-size:34px">${draftsReady}</span><span class="muted" style="font-size:12px"> 件 確認待ち</span></div><div><span class="num" style="font-size:34px">${S.sites.filter((s) => s.status === 'done').length}</span><span class="muted" style="font-size:12px"> 現場 完了</span></div></div>
          <p class="note">完了した現場の写真から、ホームページ・Instagram・Googleマップの文章を作ります。</p></a>
        <a class="card card__pad" href="#/albums" style="display:block"><div class="row row--between"><h2 style="font-size:15px;letter-spacing:.08em">お客様の声</h2>${icon('chev', 'sm')}</div>
          <div style="margin-top:8px"><span class="num" style="font-size:34px">${reviews}</span><span class="muted" style="font-size:12px"> 件（工事アルバムから）</span></div>
          ${S.reviews.slice(-2).reverse().map((r) => `<p style="font-size:13px;margin-top:6px">${'★'.repeat(r.stars)}<span class="muted">${'★'.repeat(5 - r.stars)}</span>　${esc(r.text || '')}</p>`).join('') || '<p class="note">工事アルバムの最後に、口コミをお願いする流れを入れています。</p>'}</a>
      </div>
    </div>
  </div>`;
  return {
    title: '社長ダッシュボード', sub: '今日の現場と月次レポート', backTo: '#/', html, live: true,
    mount(root) {
      weather().then((w) => {
        const el = root.querySelector('#d-wx'); if (!el) return; const j = paintJudge(w);
        el.innerHTML = `<div class="hero__date">PAINTING CONDITION</div><div class="hero__hello" style="font-size:17px">今日の塗装条件</div>
          <div class="wx" style="margin-top:10px"><div class="wx__icon">${icon(wxIcon(w.code))}</div><div><div class="wx__main"><span class="wx__t">${w.t}<small>℃</small></span><span class="wx__sub">湿度 ${w.h}%<br>${wxLabel(w.code)}${w.live ? '' : '（デモ値）'}</span></div></div>
          <div class="wx__judge"><span class="judge judge--${j.cls}"><i></i>${j.l}</span><span style="opacity:.7;font-size:12px">${esc(j.why || '')}</span></div></div>
          <p class="wx__sub" style="margin-top:8px">目安：気温5℃以上・湿度85%未満（塗料の仕様が優先）</p>`;
      });
    },
  };
}

function monthlyChart() {
  const m = MONTHLY; const W = 640, H = 220, L = 28, B = 26, T = 12;
  const max = Math.max(...m.inquiries, ...m.reviews, ...m.applies, ...m.posts, 1);
  const gw = (W - L) / m.labels.length; const bw = Math.min(16, gw / 5);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="月次レポート">`;
  for (let g = 0; g <= 4; g++) { const v = Math.round((max / 4) * g); s += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(17,19,23,.08)"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`; }
  m.labels.forEach((lb, i) => {
    const cx = L + gw * i + gw / 2;
    [[m.inquiries[i], '#ee6a1f'], [m.reviews[i], '#2a6f97'], [m.applies[i], '#2c8a5a']].forEach(([v, c], j) => {
      const x = cx + (j - 1.5) * (bw + 3);
      s += `<rect x="${x}" y="${y(v)}" width="${bw}" height="${H - B - y(v)}" rx="3" fill="${c}" opacity="${i === m.labels.length - 1 ? 1 : .78}"><animate attributeName="height" from="0" to="${H - B - y(v)}" dur=".8s" fill="freeze"/><animate attributeName="y" from="${H - B}" to="${y(v)}" dur=".8s" fill="freeze"/></rect>`;
    });
    s += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${lb}</text>`;
  });
  const pts = m.posts.map((v, i) => `${L + gw * i + gw / 2},${y(v)}`).join(' ');
  s += `<polyline points="${pts}" fill="none" stroke="#111317" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  m.posts.forEach((v, i) => { s += `<circle cx="${L + gw * i + gw / 2}" cy="${y(v)}" r="4" fill="#fffdf8" stroke="#111317" stroke-width="2"/>`; });
  return s + '</svg>';
}
