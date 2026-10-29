/**
 * 西島塗装 現場アプリ — GAS（スプレッドシート・ドライブ）側
 *
 * アプリ（GitHub Pages で公開した画面）から呼ばれ、写真をドライブの工程フォルダに保存し、
 * 写真台帳・打刻・日報をスプレッドシートに書き込みます。PC とスマホで同じデータを見られます。
 *
 * 使い方：README の「スプレッドシート連携」を参照。最初に一度だけ setup() を実行します。
 */

var SHEET = { sites: '現場', photos: '写真台帳', punches: '打刻', reports: '日報', reviews: 'お客様の声' };
var HEAD = {
  sites: ['現場ID', '現場名', '市町村', '工事の種類', '工事名', '状態', '着工日', '完了日', 'トークン', '担当', '緯度', '経度', '使用材料(JSON)', 'メモ'],
  photos: ['写真ID', '現場ID', '工程', '撮るもの番号', '部位', '撮影者', '撮影日時', 'ひとこと', '天候(JSON)', 'アルバム掲載', '発信に使う', 'ファイルID', 'ファイル名', 'URL'],
  punches: ['打刻ID', '職人', '現場ID', '種類', '日時', '現場からの距離(m)'],
  reports: ['日報ID', '職人', '現場ID', '日付', '作業', 'ひとこと', '登録日時'],
  reviews: ['ID', '現場ID', '星', '感想', '日時'],
};
var STEP_LABEL = {
  before: '着工前', scaffold: '足場', wash: '高圧洗浄', repair: '下地補修', mask: '養生', coat1: '下塗り', coat2: '中塗り', coat3: '上塗り',
  trim: '付帯部', done: '完了', fix: '是正', remove: '撤去', prep: '下地調整', carry: '材料搬入', sheet: '通気緩衝シート',
  layer1: '防水1層目', layer2: '防水2層目', top: 'トップコート', kere: 'ケレン', rust1: '錆止め1回目', rust2: '錆止め2回目',
  mid: '中塗り', fin: '上塗り', tape: 'マスキング', primer: 'プライマー', fill: '充填', finish: 'ならし',
};

// ---------- 最初に一度だけ実行 ----------
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET).forEach(function (k) {
    var sh = ss.getSheetByName(SHEET[k]) || ss.insertSheet(SHEET[k]);
    if (sh.getLastRow() === 0) {
      sh.appendRow(HEAD[k]);
      sh.getRange(1, 1, 1, HEAD[k].length).setFontWeight('bold').setBackground('#111317').setFontColor('#fffdf8');
      sh.setFrozenRows(1);
    }
  });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('APP_KEY')) props.setProperty('APP_KEY', Utilities.getUuid().slice(0, 12));
  if (!props.getProperty('ROOT_FOLDER_ID')) {
    var root = DriveApp.createFolder('西島塗装 現場写真');
    props.setProperty('ROOT_FOLDER_ID', root.getId());
  }
  // アプリの見本と同じ現場を登録しておく（ID とトークンをそろえると、見本の写真とつながる）
  var sites = ss.getSheetByName(SHEET.sites);
  if (sites.getLastRow() === 1) {
    var today = new Date();
    var d = function (n) { var x = new Date(today); x.setDate(x.getDate() + n); return Utilities.formatDate(x, 'Asia/Tokyo', 'yyyy-MM-dd'); };
    sites.getRange(2, 1, 4, HEAD.sites.length).setValues([
      ['N015', '長洲町 N事務所', '玉名郡長洲町', 'wall', '屋根・外壁塗装', 'active', d(-6), d(10), 'k7q2m9xn4c', 'w1,w2,w3', 32.9318, 130.4535, '{"外壁":"水谷ペイント ナノコンポジットW","屋根":"日本ペイント ファインSi"}', ''],
      ['N012', '玉名市岱明町 F様邸', '玉名市岱明町', 'wall', '屋根・外壁塗り替え', 'done', d(-42), d(-20), 'f3h8p1wz6r', 'w1,w2', 32.9302, 130.5122, '{}', ''],
      ['N018', '玉名市内 小学校', '玉名市', 'water', '屋上防水改修（通気緩衝工法）', 'done', d(-78), d(-60), 's9d4t2vb8m', 'w1,w3,w5', 32.9286, 130.5636, '{}', ''],
      ['N021', '荒尾市 M様邸', '荒尾市', 'wall', '外壁塗装', 'plan', d(5), d(22), 'm2x7c5kq1j', 'w1,w3', 32.9866, 130.4334, '{}', ''],
    ]);
  }
  Logger.log('準備ができました。合言葉（APP_KEY）：' + props.getProperty('APP_KEY'));
}

// ---------- 受け口 ----------
function doGet(e) {
  var p = e.parameter || {};
  try {
    if (p.action === 'ping') { check_(p.k); return json_({ ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName() }); }
    if (p.action === 'state') { check_(p.k); return json_(state_()); }
    if (p.action === 'img') { check_(p.k); return json_(img_(p.id)); }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) { return json_({ ok: false, error: String(err.message || err) }); }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  var lock = LockService.getScriptLock();
  try {
    check_(body.key);
    lock.waitLock(20000);
    switch (body.action) {
      case 'addPhoto': return json_(addPhoto_(body.photo, body.data));
      case 'addPunch': return json_(addRow_('punches', punchRow_(body.punch)));
      case 'addReport': return json_(addRow_('reports', reportRow_(body.report)));
      case 'addSite': return json_(addRow_('sites', siteRow_(body.site)));
      case 'addReview': return json_(addRow_('reviews', [body.review.id, body.review.site, body.review.stars, body.review.text, body.review.at]));
      case 'updatePhoto': return json_(updatePhoto_(body.id, body.flags));
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// ---------- 中身 ----------
function check_(k) {
  var key = PropertiesService.getScriptProperties().getProperty('APP_KEY');
  if (!key || k !== key) throw new Error('合言葉が違います');
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function sheet_(k) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET[k]); }
function rows_(k) {
  var sh = sheet_(k); var n = sh.getLastRow();
  return n < 2 ? [] : sh.getRange(2, 1, n - 1, HEAD[k].length).getValues();
}
function iso_(v) { return v instanceof Date ? v.toISOString() : String(v || ''); }
function ymd_(v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd') : String(v || ''); }
function parse_(s, fb) { try { return s ? JSON.parse(s) : fb; } catch (e) { return fb; } }

function addRow_(k, row) { sheet_(k).appendRow(row); return { ok: true }; }

function siteRow_(s) {
  folder_(s.id, null);
  return [s.id, s.name, s.place, s.kind, s.title, s.status, s.start, s.end, s.token, (s.crew || []).join(','), s.lat, s.lng, JSON.stringify(s.paint || {}), s.memo || ''];
}
function punchRow_(p) { return [p.id, p.w, p.site, p.type, p.at, p.geo == null ? '' : p.geo]; }
function reportRow_(r) { return [r.id, r.w, r.site, r.date, (r.works || []).join('、'), r.note, r.at]; }

// 現場フォルダ／工程フォルダ（なければ作る）
function folder_(siteId, step) {
  var root = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID'));
  var it = root.getFoldersByName(siteId);
  var sf = it.hasNext() ? it.next() : root.createFolder(siteId);
  if (!step) return sf;
  var name = STEP_LABEL[step] || step;
  var it2 = sf.getFoldersByName(name);
  return it2.hasNext() ? it2.next() : sf.createFolder(name);
}

function addPhoto_(p, data) {
  // 二重送信を防ぐ（電波が切れて再送されたとき）
  var exist = rows_('photos').filter(function (r) { return r[0] === p.id; })[0];
  if (exist) return { ok: true, rid: exist[11] };
  var blob = Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', p.fn);
  var file = folder_(p.site, p.step).createFile(blob);
  sheet_('photos').appendRow([p.id, p.site, p.step, p.shot, p.part, p.by, p.at, p.note || '', JSON.stringify(p.wx || {}),
    p.flags && p.flags.album !== false, !!(p.flags && p.flags.post), file.getId(), p.fn, file.getUrl()]);
  return { ok: true, rid: file.getId() };
}

function updatePhoto_(id, flags) {
  var sh = sheet_('photos'); var rs = rows_('photos');
  for (var i = 0; i < rs.length; i++) {
    if (rs[i][0] === id) { sh.getRange(i + 2, 10, 1, 2).setValues([[!!flags.album, !!flags.post]]); return { ok: true }; }
  }
  return { ok: false, error: 'not found' };
}

function img_(fileId) {
  var b = DriveApp.getFileById(fileId).getBlob();
  return { ok: true, mime: b.getContentType(), data: Utilities.base64Encode(b.getBytes()) };
}

function state_() {
  return {
    ok: true,
    sites: rows_('sites').map(function (r) {
      return { id: r[0], name: r[1], place: r[2], kind: r[3], title: r[4], status: r[5], start: ymd_(r[6]), end: ymd_(r[7]), token: r[8],
        crew: String(r[9] || '').split(',').filter(String), lat: Number(r[10]), lng: Number(r[11]), paint: parse_(r[12], {}), memo: r[13], cover: '' };
    }),
    photos: rows_('photos').map(function (r) {
      return { id: r[0], site: r[1], step: r[2], shot: Number(r[3]), part: r[4], by: r[5], at: iso_(r[6]), note: r[7], wx: parse_(r[8], null),
        flags: { album: r[9] === true || r[9] === 'TRUE', post: r[10] === true || r[10] === 'TRUE' }, rid: r[11], blob: true };
    }),
    punches: rows_('punches').map(function (r) { return { id: r[0], w: r[1], site: r[2], type: r[3], at: iso_(r[4]), geo: r[5] === '' ? null : Number(r[5]) }; }),
    reports: rows_('reports').map(function (r) { return { id: r[0], w: r[1], site: r[2], date: ymd_(r[3]), works: String(r[4] || '').split('、').filter(String), note: r[5], at: iso_(r[6]) }; }),
  };
}
