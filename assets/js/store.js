// データの保存（端末内）と、GAS（スプレッドシート）との連携。
import { SITES, WORKERS, KINDS, COMPANY, seedPhotos, seedPunches, seedReports } from './data.js';

const VERSION = 3;
const DB_NAME = 'nishijima-genba';
let db = null;
export let S = null;
const listeners = new Set();

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('blob')) d.createObjectStore('blob');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
  });
}
const kvGet = (k) => new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); });
const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
export const putBlob = (id, blob) => tx('blob', 'readwrite', (s) => s.put(blob, id));
export const getBlob = (id) => new Promise((res) => { const r = db.transaction('blob').objectStore('blob').get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });

function fresh() {
  return {
    v: VERSION,
    me: 'w4',
    modules: { clock: true, camera: true, ledger: true, album: true, writer: true, dash: true },
    settings: { demoGeo: true, gasUrl: '', gasKey: '', boardDefault: true, gridDefault: true },
    workers: WORKERS.map((w) => ({ ...w })),
    sites: SITES.map((s) => ({ ...s })),
    photos: seedPhotos(),
    punches: seedPunches(),
    reports: seedReports(),
    drafts: {},
    reviews: [],
    queue: [],
    seenAt: {},
  };
}

export async function init() {
  try { db = await openDB(); } catch (e) { db = null; }
  let saved = null;
  if (db) saved = await kvGet('state');
  if (!saved) { try { saved = JSON.parse(localStorage.getItem('nishijima-genba') || 'null'); } catch (e) { saved = null; } }
  S = saved && saved.v === VERSION ? saved : fresh();
  return S;
}

let saveTimer = 0;
export function save(now = false) {
  clearTimeout(saveTimer);
  const run = () => {
    if (db) kvSet('state', S).catch(() => {});
    else { try { localStorage.setItem('nishijima-genba', JSON.stringify(S)); } catch (e) {} }
  };
  if (now) run(); else saveTimer = setTimeout(run, 250);
}
export function commit(why) { save(); listeners.forEach((f) => f(why)); }
export function onChange(f) { listeners.add(f); return () => listeners.delete(f); }

export async function resetAll() {
  S = fresh();
  if (db) { await tx('blob', 'readwrite', (s) => s.clear()); }
  urlCache.forEach((u) => URL.revokeObjectURL(u)); urlCache.clear();
  save(true);
}

// ---------- 便利関数 ----------
export const uid = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pad = (n) => String(n).padStart(2, '0');
export const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function dkey(d = new Date()) { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function fmtDate(d, withWd = true) { d = new Date(d); return `${d.getMonth() + 1}月${d.getDate()}日${withWd ? `（${WD[d.getDay()]}）` : ''}`; }
export function fmtTime(d) { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function fmtYmd(d) { d = new Date(d); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`; }
export function isToday(d) { return dkey(d) === dkey(); }
export function ago(d) {
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  if (m < 1) return 'たった今'; if (m < 60) return `${m}分前`;
  const h = Math.round(m / 60); if (h < 24) return `${h}時間前`;
  const dd = Math.round(h / 24); return dd < 30 ? `${dd}日前` : fmtYmd(d);
}
export const worker = (id) => S.workers.find((w) => w.id === id) || { id, name: '—', full: '—', c: '#8c877d' };
export const site = (id) => S.sites.find((s) => s.id === id);
export const kindOf = (s) => KINDS[(s && s.kind) || 'wall'];
export const stepOf = (s, k) => kindOf(s).steps.find((x) => x.k === k);
export const photosOf = (siteId) => S.photos.filter((p) => p.site === siteId).sort((a, b) => new Date(a.at) - new Date(b.at));

// ファイル名：現場番号_工程_部位_日付_時刻（お客様の名前は入らない）
export function fileName(p) {
  const s = site(p.site); const st = stepOf(s, p.step);
  const d = new Date(p.at);
  return `${p.site}_${st ? st.l : p.step}_${p.part}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.jpg`;
}

// 撮り漏れチェック
export function checklist(siteId) {
  const s = site(siteId); const ph = photosOf(siteId);
  return kindOf(s).steps.filter((st) => !st.internal).map((st) => {
    const shots = st.shots.map(([label, part], i) => {
      const got = ph.filter((p) => p.step === st.k && p.shot === i);
      return { i, label, part, done: got.length > 0, count: got.length, last: got[got.length - 1] };
    });
    const n = ph.filter((p) => p.step === st.k).length;
    return { ...st, shots, count: n, done: shots.every((x) => x.done), started: n > 0 };
  });
}
// いまの工程：写真がある最後の工程。それが揃っていれば次の工程。
export function currentStep(siteId) {
  const cl = checklist(siteId);
  let last = -1;
  cl.forEach((st, i) => { if (st.started) last = i; });
  if (last < 0) return cl[0];
  if (!cl[last].done) return cl[last];
  return cl[Math.min(last + 1, cl.length - 1)];
}
export function progress(siteId) {
  const s = site(siteId);
  if (s.status === 'done') return 1;
  const cl = checklist(siteId);
  const cur = currentStep(siteId);
  const idx = cl.findIndex((x) => x.k === cur.k);
  return Math.max(0, idx) / (cl.length - 1);
}
// 撮り漏れ：いまの工程より前で、撮れていないもの
export function missing(siteId) {
  const s = site(siteId);
  if (!s || s.status !== 'active') return [];
  const cl = checklist(siteId);
  const cur = currentStep(siteId);
  const idx = cl.findIndex((x) => x.k === cur.k);
  const out = [];
  cl.slice(0, idx).forEach((st) => st.shots.forEach((sh) => { if (!sh.done) out.push({ step: st, shot: sh }); }));
  return out;
}
// 3回塗りメーター：部位ごとに、何回目まで撮れているか
export function coatMap(siteId) {
  const s = site(siteId); const k = kindOf(s);
  const ph = photosOf(siteId);
  return k.coatParts.map((part) => ({
    part,
    coats: [1, 2, 3].map((c) => {
      const st = k.steps.find((x) => x.coat === c);
      return !!st && ph.some((p) => p.step === st.k && (p.part === part || (k.coatParts.length === 1)));
    }),
  }));
}
// 同じ構図のための見本：着工前の同じ「撮るもの」→ 前の塗り工程の同じ撮るもの
export function ghostFor(siteId, stepKey, shotIdx) {
  const s = site(siteId); const k = kindOf(s);
  const st = k.steps.find((x) => x.k === stepKey); if (!st) return null;
  const label = st.shots[shotIdx] ? st.shots[shotIdx][0] : '';
  const part = st.shots[shotIdx] ? st.shots[shotIdx][1] : '';
  const ph = photosOf(siteId);
  if (st.coat && st.coat > 1) {
    const prev = k.steps.find((x) => x.coat === st.coat - 1);
    const m = ph.filter((p) => p.step === prev.k && p.shot === shotIdx);
    if (m.length) return { p: m[m.length - 1], why: `${prev.l}と同じ構図` };
  }
  const before = k.steps[0];
  const bi = before.shots.findIndex(([l]) => l === label || (stepKey === 'done' && l.slice(0, 2) === label.slice(0, 2)));
  let m = ph.filter((p) => p.step === before.k && (bi >= 0 ? p.shot === bi : p.part === part));
  if (!m.length && stepKey === 'done') m = ph.filter((p) => p.step === before.k && p.shot === 0);
  if (m.length && stepKey !== before.k) return { p: m[0], why: '着工前と同じ構図' };
  return null;
}

// ---------- 写真のURL ----------
const urlCache = new Map();
export function imgSrc(p, size = 't') {
  if (p.src) return size === 't' ? (p.thumb || p.src) : p.src;
  const key = size === 't' ? `${p.id}_t` : p.id;
  return urlCache.get(key) || '';
}
export function imgTag(p, size = 't', attrs = '') {
  const src = imgSrc(p, size);
  if (src) return `<img src="${src}" alt="" loading="lazy" decoding="async" ${attrs}>`;
  return `<img data-pid="${p.id}" data-sz="${size}" alt="" ${attrs} src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`;
}
export async function hydrate(root = document) {
  const imgs = root.querySelectorAll('img[data-pid]');
  for (const el of imgs) {
    const id = el.dataset.pid; const size = el.dataset.sz;
    const key = size === 't' ? `${id}_t` : id;
    let u = urlCache.get(key);
    if (!u && db) {
      let b = await getBlob(key);
      if (!b && size === 't') b = await getBlob(id);
      if (!b) b = await fetchRemoteImage(id, size);
      if (b) { u = URL.createObjectURL(b); urlCache.set(key, u); }
    }
    if (u) { el.src = u; el.removeAttribute('data-pid'); }
  }
}

// ---------- 天気（塗装できるか） ----------
let wxCache = null;
export async function weather(lat = COMPANY.lat, lng = COMPANY.lng) {
  if (wxCache && Date.now() - wxCache.at < 15 * 60000) return wxCache;
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=precipitation_probability&forecast_hours=6&timezone=Asia%2FTokyo`;
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(u, { signal: ctrl.signal }); clearTimeout(tm);
    const j = await r.json();
    const pp = (j.hourly && j.hourly.precipitation_probability) || [];
    wxCache = { at: Date.now(), live: true, t: Math.round(j.current.temperature_2m), h: Math.round(j.current.relative_humidity_2m), code: j.current.weather_code, wind: Math.round(j.current.wind_speed_10m / 3.6), rain3: Math.max(0, ...pp.slice(0, 4)) };
  } catch (e) {
    wxCache = { at: Date.now(), live: false, t: 19, h: 58, code: 1, wind: 3, rain3: 10 };
  }
  return wxCache;
}
// 塗装の目安：気温5℃以上・湿度85%未満・雨の心配がないこと（塗料メーカーの仕様が優先）
export function paintJudge(w) {
  if (!w) return { cls: 'warn', l: '確認中' };
  const rainNow = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(w.code);
  if (rainNow || w.t < 5 || w.h >= 85) return { cls: 'ng', l: '塗装は見合わせ', why: rainNow ? '雨が降っています' : w.t < 5 ? '気温が5℃未満です' : '湿度が85%以上です' };
  if (w.rain3 >= 50 || w.h >= 80 || w.t < 8) return { cls: 'warn', l: '注意して塗装', why: w.rain3 >= 50 ? `3時間以内の降水確率 ${w.rain3}%` : w.h >= 80 ? '湿度が高めです' : '気温が低めです' };
  return { cls: 'ok', l: '塗装OK', why: `3時間以内の降水確率 ${w.rain3}%` };
}
export function wxIcon(code) {
  if ([0].includes(code)) return 'sun';
  if ([1, 2].includes(code)) return 'partly';
  if ([3, 45, 48].includes(code)) return 'cloud';
  return 'rain';
}
export function wxLabel(code) {
  if (code === 0) return '快晴'; if (code === 1) return '晴れ'; if (code === 2) return '晴れ時々くもり'; if (code === 3) return 'くもり';
  if ([45, 48].includes(code)) return '霧'; if (code >= 51 && code <= 67) return '雨'; if (code >= 71 && code <= 77) return '雪'; if (code >= 80) return 'にわか雨';
  return '—';
}

// ---------- 距離（現場に着いたか） ----------
export function distM(a, b) {
  const R = 6371000, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// ---------- 出退勤の状態 ----------
export function punchesOf(w, day = dkey()) { return S.punches.filter((p) => p.w === w && dkey(p.at) === day).sort((a, b) => new Date(a.at) - new Date(b.at)); }
export function stateOf(w, day = dkey()) {
  const ps = punchesOf(w, day);
  const last = ps[ps.length - 1];
  if (!last) return { k: 'off', l: '未出勤', c: '#a9a49a' };
  return ({
    in: { k: 'work', l: '作業中', c: '#4ade80' },
    back: { k: 'work', l: '作業中', c: '#4ade80' },
    break: { k: 'break', l: '休憩中', c: '#fbbf24' },
    out: { k: 'done', l: '退勤済み', c: '#94a3b8' },
    rain: { k: 'rain', l: '雨天中止', c: '#60a5fa' },
  })[last.type];
}
// 1日の実働（分）
export function workMinutes(ps) {
  let total = 0, start = null;
  for (const p of ps) {
    if (p.type === 'in' || p.type === 'back') start = new Date(p.at);
    if ((p.type === 'break' || p.type === 'out') && start) { total += (new Date(p.at) - start) / 60000; start = null; }
  }
  return Math.round(total);
}

// ---------- GAS（スプレッドシート）連携 ----------
export const remoteOn = () => !!(S && S.settings.gasUrl);
async function gasPost(action, payload) {
  const r = await fetch(S.settings.gasUrl, { method: 'POST', body: JSON.stringify({ action, key: S.settings.gasKey, ...payload }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'error');
  return j;
}
export async function gasTest(url, key) {
  const r = await fetch(`${url}?action=ping&k=${encodeURIComponent(key || '')}`);
  return r.json();
}
export function enqueue(action, payload) {
  S.queue.push({ id: uid('q'), action, payload, tries: 0 });
  save();
  flush();
}
let flushing = false;
export async function flush() {
  if (!remoteOn() || flushing || !navigator.onLine) return;
  flushing = true;
  try {
    while (S.queue.length) {
      const job = S.queue[0];
      if (job.action === 'addPhoto' && !job.payload.data) {
        const b = await getBlob(job.payload.photo.id);
        if (b) job.payload.data = await blobToB64(b);
      }
      try {
        const res = await gasPost(job.action, job.payload);
        if (job.action === 'addPhoto' && res.rid) {
          const p = S.photos.find((x) => x.id === job.payload.photo.id);
          if (p) { p.rid = res.rid; p.pending = false; }
        }
        S.queue.shift(); save(); listeners.forEach((f) => f('sync'));
      } catch (e) {
        job.tries++; save();
        break;
      }
    }
  } finally { flushing = false; }
}
export async function pull() {
  if (!remoteOn()) return false;
  try {
    const r = await fetch(`${S.settings.gasUrl}?action=state&k=${encodeURIComponent(S.settings.gasKey || '')}`);
    const j = await r.json();
    if (!j.ok) return false;
    let changed = false;
    const merge = (arr, incoming, key = 'id') => {
      for (const it of incoming || []) {
        const i = arr.findIndex((x) => x[key] === it[key]);
        if (i < 0) { arr.push(it); changed = true; }
        else if (JSON.stringify(arr[i].flags) !== JSON.stringify(it.flags) && it.flags) { arr[i].flags = it.flags; changed = true; }
      }
    };
    merge(S.sites, j.sites);
    merge(S.photos, (j.photos || []).map((p) => ({ ...p, pending: false })));
    merge(S.punches, j.punches);
    merge(S.reports, j.reports);
    if (changed) { save(); listeners.forEach((f) => f('pull')); }
    return true;
  } catch (e) { return false; }
}
async function fetchRemoteImage(id, size) {
  if (!remoteOn()) return null;
  const p = S.photos.find((x) => x.id === id);
  if (!p || !p.rid) return null;
  try {
    const r = await fetch(`${S.settings.gasUrl}?action=img&id=${encodeURIComponent(p.rid)}&k=${encodeURIComponent(S.settings.gasKey || '')}`);
    const j = await r.json();
    if (!j.ok) return null;
    const b = b64ToBlob(j.data, j.mime || 'image/jpeg');
    await putBlob(id, b);
    return b;
  } catch (e) { return null; }
}
export function blobToB64(b) {
  return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); });
}
function b64ToBlob(b64, mime) {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}
