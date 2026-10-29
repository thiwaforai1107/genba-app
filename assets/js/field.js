// 出退勤：直行直帰の塗装現場向け。現場を選んで打刻・雨天中止・退勤時の日報。
import { icon } from './icons.js';
import { WORK_CHIPS } from './data.js';
import {
  S, commit, esc, uid, worker, site, stateOf, punchesOf, workMinutes, fmtTime, fmtDate, dkey, distM, photosOf,
  isToday, weather, paintJudge, remoteOn, enqueue, pad,
} from './store.js';
import { toast, sheet, vibrate } from './ui.js';
import { avatar, go, rerender, pickMe } from './app.js';

const LABEL = { in: '出勤', break: '休憩', back: '作業に戻る', out: '退勤', rain: '雨天中止' };
const TC = { in: '#2c8a5a', break: '#8c877d', back: '#2a6f97', out: '#d7262e', rain: '#3d5a80' };

function mySiteId() {
  const ps = punchesOf(S.me);
  if (ps.length) return ps[ps.length - 1].site;
  if (S._clockSite) return S._clockSite;
  const s = S.sites.find((x) => x.status === 'active' && x.crew.includes(S.me)) || S.sites.find((x) => x.status === 'active');
  return s ? s.id : S.sites[0].id;
}

export function clockView(q) {
  const tab = q.tab || 'punch';
  const tabs = `<div class="seg" style="margin:4px 0 14px">${[['punch', '打刻'], ['team', '今日のチーム'], ['month', '月の集計']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (tab === 'punch') body = punchHtml();
  if (tab === 'team') body = teamHtml();
  if (tab === 'month') body = monthHtml(q.m || 'this');
  return {
    title: '出退勤', sub: fmtDate(new Date()), backTo: '#/', live: tab !== 'punch',
    html: `<div class="page ${tab === 'month' ? 'page--wide' : ''}">${tabs}${body}</div>`,
    mount(root) {
      root.addEventListener('click', (e) => onClick(e, root));
      const t = setInterval(() => {
        const el = root.querySelector('#clk');
        if (el) { const d = new Date(); el.innerHTML = `${pad(d.getHours())}:${pad(d.getMinutes())}<small>${pad(d.getSeconds())}</small>`; }
      }, 1000);
      weather().then((w) => {
        const el = root.querySelector('#clk-wx'); if (!el) return;
        const j = paintJudge(w);
        el.innerHTML = `<span class="judge judge--${j.cls}" style="margin-top:14px"><i></i>${w.t}℃ ${w.h}%・${j.l}</span>`;
      });
      return () => clearInterval(t);
    },
  };
}

function punchHtml() {
  const me = worker(S.me);
  const st = stateOf(S.me);
  const ps = punchesOf(S.me);
  const sid = mySiteId(); const s = site(sid);
  const first = ps.find((p) => p.type === 'in');
  const geo = first && first.geo != null ? `<span class="geo">${icon('pin', 'sm')}現場から ${first.geo}m で打刻</span>` : '';
  const btn = (type, cls, label, sub, dis = false) => `<button class="punch punch--${cls}" data-punch="${type}" ${dis ? 'disabled' : ''}>${label}<small>${sub}</small></button>`;
  let buttons = '';
  if (st.k === 'off') buttons = btn('in', 'in', `${icon('power', 'lg')} 出勤`, 'CLOCK IN') + `<button class="punch punch--rain" data-punch="rain">${icon('umbrella')} 雨で作業中止にする</button>`;
  if (st.k === 'work') buttons = btn('break', 'break', `${icon('coffee')} 休憩`, 'BREAK') + btn('out', 'out', `${icon('logout')} 退勤`, 'CLOCK OUT');
  if (st.k === 'break') buttons = btn('back', 'back', `${icon('play')} 戻る`, 'BACK') + btn('out', 'out', `${icon('logout')} 退勤`, 'CLOCK OUT');
  const mins = workMinutes(ps);
  const doneMsg = st.k === 'done' ? `<div class="alert alert--ok" style="margin-top:14px">${icon('check')}<div><b>お疲れさまでした</b>${fmtTime(first?.at || ps[0].at)}〜${fmtTime(ps[ps.length - 1].at)}・実働 ${Math.floor(mins / 60)}時間${mins % 60}分</div></div>` : '';
  const rainMsg = st.k === 'rain' ? `<div class="alert alert--info" style="margin-top:14px">${icon('umbrella')}<div><b>今日は雨天中止で記録しました</b>${fmtTime(ps[ps.length - 1].at)}・${esc(s.name)}</div></div>` : '';
  const todayPh = S.photos.filter((p) => p.by === S.me && isToday(p.at)).length;

  return `
  <section class="clock rise" style="--glow:${st.k === 'work' ? 'rgba(44,138,90,.35)' : st.k === 'break' ? 'rgba(201,138,18,.3)' : 'rgba(238,106,31,.25)'}">
    <div class="clock__who">${avatar(me, 'avatar--lg')}<div style="flex:1"><b>${esc(me.full)}</b><span>${esc(me.role)}・${esc(me.note)}</span></div>
      <button class="iconbtn" style="color:#fff;background:rgba(255,255,255,.08)" data-x="me" aria-label="切り替え">${icon('switch')}</button></div>
    <div class="clock__time num" id="clk">--:--</div>
    <div class="clock__date">${fmtDate(new Date())}</div>
    <div class="row" style="gap:8px;flex-wrap:wrap"><span class="state" style="--sc:${st.c}"><i></i>${st.l}</span><span id="clk-wx"></span></div>
    <button class="siteSel" data-x="site" ${st.k !== 'off' ? 'disabled' : ''}>${icon('pin')}<span style="flex:1"><span>今日の現場</span><b>${esc(s.name)}</b>${geo}</span>${st.k === 'off' ? icon('chevDown', 'sm') : ''}</button>
  </section>
  <div class="punches">${buttons}</div>
  ${doneMsg}${rainMsg}
  ${ps.length ? `<div class="sec"><div class="sec__head"><span class="en">TODAY</span><h2>今日の記録</h2></div>
    <div class="card card__pad"><div class="timeline">${ps.map((p) => `<div class="tl" style="--tc:${TC[p.type]}"><b>${fmtTime(p.at)}</b><span>${LABEL[p.type]}</span><small>${esc(site(p.site)?.name || '')}</small></div>`).join('')}</div></div></div>` : ''}
  ${st.k === 'work' && S.modules.camera ? `<a class="mod mod--hero" href="#/camera?site=${sid}" style="--c:#ee6a1f;margin-top:14px"><span class="mod__ic">${icon('camera')}</span><span><b>現場写真を撮る</b><p>今日あなたが撮った写真：${todayPh}枚</p></span><span class="go">${icon('chev')}</span></a>` : ''}
  <p class="note" style="margin:18px 4px">位置情報は「現場に着いたか」の確認だけに使います。移動の記録はしません。${S.settings.demoGeo ? '（いまはデモの値を表示しています）' : ''}</p>`;
}

function teamHtml() {
  const rows = S.workers.map((w) => {
    const st = stateOf(w.id); const ps = punchesOf(w.id);
    const fi = ps.find((p) => p.type === 'in' || p.type === 'rain');
    const out = ps.find((p) => p.type === 'out');
    const ph = S.photos.filter((p) => p.by === w.id && isToday(p.at)).length;
    return `<div class="li">${avatar(w)}<div class="li__body"><b>${esc(w.full)}</b><span>${fi ? `${esc(site(fi.site)?.name || '')}` : '—'}</span></div>
      <div class="li__end"><span class="state" style="--sc:${st.c};margin:0;background:var(--paper);font-size:11.5px"><i></i>${st.l}</span>
      <div class="muted" style="font-size:11.5px;margin-top:4px">${fi ? fmtTime(fi.at) : '--:--'} 〜 ${out ? fmtTime(out.at) : '--:--'}　写真 ${ph}枚</div></div></div>`;
  }).join('');
  // 打刻漏れ（過去の日で、出勤があるのに退勤がない）
  const miss = [];
  const days = [...new Set(S.punches.map((p) => dkey(p.at)))].filter((d) => d !== dkey());
  for (const d of days) for (const w of S.workers) {
    const ps = punchesOf(w.id, d);
    if (ps.some((p) => p.type === 'in') && !ps.some((p) => p.type === 'out')) miss.push({ w, d });
  }
  return `<div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi" style="--k:#2c8a5a"><small>作業中</small><b>${S.workers.filter((w) => stateOf(w.id).k === 'work').length}<small> 人</small></b></div>
      <div class="kpi" style="--k:#c98a12"><small>休憩中</small><b>${S.workers.filter((w) => stateOf(w.id).k === 'break').length}<small> 人</small></b></div>
      <div class="kpi" style="--k:#8c877d"><small>未出勤</small><b>${S.workers.filter((w) => stateOf(w.id).k === 'off').length}<small> 人</small></b></div></div>
    <div class="list" style="margin-top:14px">${rows}</div>
    ${miss.length ? `<div class="sec"><div class="sec__head"><span class="en">CHECK</span><h2>打刻漏れ</h2></div>${miss.map((m) => `<div class="alert" style="margin-bottom:8px">${icon('alert')}<div><b>${esc(m.w.full)}：${fmtDate(m.d)}の退勤がありません</b>本人に確認して、退勤時刻を直してください（元の記録は残ります）。</div></div>`).join('')}</div>` : ''}`;
}

function monthData(which) {
  const now = new Date();
  const base = which === 'last' ? new Date(now.getFullYear(), now.getMonth() - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  const ym = `${base.getFullYear()}-${pad(base.getMonth() + 1)}`;
  const days = [...new Set(S.punches.filter((p) => dkey(p.at).startsWith(ym)).map((p) => dkey(p.at)))].sort();
  return {
    ym, label: `${base.getFullYear()}年${base.getMonth() + 1}月`,
    rows: S.workers.filter((w) => w.role !== '協力業者').map((w) => {
      let work = 0, mins = 0, over = 0, rain = 0, miss = 0;
      for (const d of days) {
        const ps = punchesOf(w.id, d);
        if (!ps.length) continue;
        if (ps.some((p) => p.type === 'rain')) { rain++; continue; }
        work++;
        const m = workMinutes(ps); mins += m; over += Math.max(0, m - 480);
        if (!ps.some((p) => p.type === 'out') && d !== dkey()) miss++;
      }
      return { w, work, mins, over, rain, miss };
    }),
  };
}
const hm = (m) => `${Math.floor(m / 60)}:${pad(m % 60)}`;

function monthHtml(which) {
  const md = monthData(which);
  return `<div class="row row--between" style="margin-bottom:10px"><div class="seg" style="width:220px">${[['this', '今月'], ['last', '先月']].map(([k, l]) => `<button class="${which === k ? 'on' : ''}" data-month="${k}">${l}</button>`).join('')}</div>
      <button class="btn btn--ink btn--sm" data-x="csv">${icon('download', 'sm')}給与ソフト用CSV</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>氏名</th><th>出勤日数</th><th>実働時間</th><th>残業（8h超）</th><th>雨天中止</th><th>打刻漏れ</th></tr></thead><tbody>
      ${md.rows.map((r) => `<tr><td><div class="row">${avatar(r.w)}<b>${esc(r.w.full)}</b></div></td><td class="num">${r.work}<small class="muted">日</small></td><td class="num">${hm(r.mins)}</td><td class="num">${hm(r.over)}</td><td class="num">${r.rain}<small class="muted">日</small></td><td>${r.miss ? `<span class="tag tag--r">${r.miss}件</span>` : '<span class="tag tag--g">なし</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="note" style="margin-top:12px">${md.label}の集計です。給与額の計算はこのアプリでは行いません（割増賃金や端数処理は就業規則・法令に合わせ、給与ソフトで計算します）。雨天中止の日は、会社のルールに合わせて扱いを決められます。</p>`;
}

function onClick(e, root) {
  const tabB = e.target.closest('[data-tab]'); if (tabB) { go(`#/clock?tab=${tabB.dataset.tab}`); return; }
  const mB = e.target.closest('[data-month]'); if (mB) { go(`#/clock?tab=month&m=${mB.dataset.month}`); return; }
  const x = e.target.closest('[data-x]');
  if (x) {
    if (x.dataset.x === 'me') pickMe(() => rerender());
    if (x.dataset.x === 'site') pickSite();
    if (x.dataset.x === 'csv') downloadCsv();
    return;
  }
  const p = e.target.closest('[data-punch]');
  if (p) doPunch(p.dataset.punch);
}

function pickSite() {
  const list = S.sites.filter((s) => s.status !== 'done');
  sheet(`<div class="sheet__title">今日の現場</div><div class="sheet__sub">いる現場を選んでください。</div>
    <div class="list">${list.map((s) => `<button class="li" data-s="${s.id}"><span class="li__ic">${icon('building', 'sm')}</span><div class="li__body"><b>${esc(s.name)}</b><span>${s.id}・${esc(s.title)}</span></div>${mySiteId() === s.id ? `<span class="check on">${icon('check')}</span>` : ''}</button>`).join('')}</div>`, {
    onOpen(el, close) { el.addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; S._clockSite = b.dataset.s; commit('site'); close(); rerender(); }); },
  });
}

async function geoDistance(s) {
  if (S.settings.demoGeo) return 40 + Math.round(Math.random() * 110);
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition((pos) => res(distM({ lat: pos.coords.latitude, lng: pos.coords.longitude }, s)), () => res(null), { timeout: 5000, maximumAge: 60000 });
  });
}

function addPunch(type, geo) {
  const sid = mySiteId();
  const p = { id: uid('k'), w: S.me, site: sid, type, at: new Date().toISOString(), geo: geo ?? null };
  S.punches.push(p); commit('punch');
  if (remoteOn()) enqueue('addPunch', { punch: p });
  vibrate(30);
  return p;
}

async function doPunch(type) {
  const s = site(mySiteId());
  if (type === 'in') {
    const d = await geoDistance(s);
    addPunch('in', d);
    toast(`${fmtTime(new Date())} 出勤しました${d != null ? `（現場から${d}m）` : ''}`);
    rerender(false);
  }
  if (type === 'break') { addPunch('break'); toast('休憩に入りました'); rerender(false); }
  if (type === 'back') { addPunch('back'); toast('作業に戻りました'); rerender(false); }
  if (type === 'rain') rainSheet(s);
  if (type === 'out') reportSheet(s);
}

function rainSheet(s) {
  sheet(`<div class="sheet__title">${icon('umbrella')} 雨で作業中止にしますか？</div>
    <div class="sheet__sub">${esc(s.name)}・${fmtDate(new Date())}<br>工程表の見直しと、お客様への連絡のきっかけになります。</div>
    <div class="grid2"><button class="btn btn--ghost" data-close>やめる</button><button class="btn btn--ink" id="rain-go">中止を記録する</button></div>`, {
    onOpen(el, close) { el.querySelector('#rain-go').addEventListener('click', () => { addPunch('rain'); close(); toast('雨天中止を記録しました'); rerender(false); }); },
  });
}

function reportSheet(s) {
  const todayPh = photosOf(s.id).filter((p) => isToday(p.at));
  const mine = todayPh.filter((p) => p.by === S.me).length;
  sheet(`<div class="sheet__title">今日の作業を残して退勤</div>
    <div class="sheet__sub">${esc(s.name)}・選ぶだけで日報になります（社長のダッシュボードに届きます）</div>
    <div class="stack">
      <div class="field"><label>今日やった作業</label><div class="chips" id="rp-w">${WORK_CHIPS.map((w) => `<button class="chip" data-w="${w}">${w}</button>`).join('')}</div></div>
      <div class="field"><label>ひとこと（任意）</label><textarea class="textarea" id="rp-n" placeholder="例）北面の下塗り完了。明日は中塗り。"></textarea></div>
      ${mine ? `<div class="alert alert--ok">${icon('camera')}<div><b>今日の写真 ${mine}枚</b>工程ごとに整理されています。</div></div>`
        : `<div class="alert">${icon('camera')}<div><b>今日の写真がまだありません</b>退勤の前に1枚だけでも撮っておくと、撮り漏れを防げます。</div></div>`}
      <div class="grid2">${!mine && S.modules.camera ? `<a class="btn btn--ghost" href="#/camera?site=${s.id}" data-close>${icon('camera')}先に撮る</a>` : '<button class="btn btn--ghost" data-close>戻る</button>'}<button class="btn btn--primary" id="rp-go">${icon('logout')}退勤する</button></div>
    </div>`, {
    onOpen(el, close) {
      const sel = new Set();
      el.querySelector('#rp-w').addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (!b) return; b.classList.toggle('on'); sel.has(b.dataset.w) ? sel.delete(b.dataset.w) : sel.add(b.dataset.w); });
      el.querySelector('#rp-go').addEventListener('click', () => {
        addPunch('out');
        const r = { id: uid('r'), w: S.me, site: s.id, date: dkey(), works: [...sel], note: el.querySelector('#rp-n').value.trim(), at: new Date().toISOString() };
        S.reports.push(r); commit('report');
        if (remoteOn()) enqueue('addReport', { report: r });
        close(); toast('退勤しました。お疲れさまでした'); rerender(false);
      });
    },
  });
}

function downloadCsv() {
  const md = monthData('this');
  const lines = [['氏名', '日付', '現場', '出勤', '退勤', '実働(分)', '区分']];
  const days = [...new Set(S.punches.map((p) => dkey(p.at)))].filter((d) => d.startsWith(md.ym)).sort();
  for (const w of S.workers) for (const d of days) {
    const ps = punchesOf(w.id, d); if (!ps.length) continue;
    const fi = ps.find((p) => p.type === 'in'); const out = ps.find((p) => p.type === 'out');
    const rain = ps.some((p) => p.type === 'rain');
    lines.push([w.full, d, site(ps[0].site)?.name || '', fi ? fmtTime(fi.at) : '', out ? fmtTime(out.at) : '', rain ? 0 : workMinutes(ps), rain ? '雨天中止' : out ? '通常' : '退勤打刻なし']);
  }
  const csv = '﻿' + lines.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `勤怠_${md.ym}.csv`; a.click();
  toast('CSVを書き出しました');
}
