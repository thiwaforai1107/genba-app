// お客様・発信の画面：工事アルバム（PLAN B）と、発信の下書き（PLAN A）
import { icon, mark, starFill } from './icons.js';
import { COMPANY } from './data.js';
import {
  S, commit, esc, uid, worker, site, kindOf, stepOf, photosOf, imgTag, imgSrc, hydrate, checklist, currentStep,
  fmtDate, fmtYmd, dkey, remoteOn, enqueue,
} from './store.js';
import { toast, sheet, qrSvg, copyText, baHtml, bindBA } from './ui.js';
import { avatar, go, rerender, stepperHtml, albumUrl } from './app.js';

// ---------- アルバム一覧（社内） ----------
export function albumsView() {
  const sites = S.sites.filter((s) => photosOf(s.id).length);
  const html = `<div class="page page--wide">
    <div class="ai rise" style="margin-bottom:16px"><h2>お客様専用の「工事アルバム」</h2>
      <p>URLを開くだけ。ログインもアプリも要りません。着工前から完成まで、工程の順に写真が並びます。現場ごとに推測できないURLなので、ほかのお客様の写真は見えません。</p>
      <div class="flow"><span>現場で撮る</span>${icon('chev')}<span>自動で工程順に</span>${icon('chev')}<span>URLをLINEで送る</span>${icon('chev')}<span>口コミのお願い</span></div></div>
    <div class="dash">${sites.map((s, i) => {
      const ph = photosOf(s.id).filter((p) => p.flags?.album);
      const cover = imgSrc(ph[ph.length - 1] || photosOf(s.id).slice(-1)[0], 'f');
      return `<div class="card w4 rise d${i + 1}" style="overflow:hidden">
        <a href="#/album/${s.token}?from=app" style="display:block;aspect-ratio:16/10;background:url('${cover}') center/cover;position:relative">
          <span class="tag tag--ink en" style="position:absolute;left:12px;top:12px">${s.id}</span>
          <span class="tag ${s.status === 'done' ? 'tag--g' : 'tag--o'}" style="position:absolute;right:12px;top:12px">${s.status === 'done' ? '完成' : '工事中も更新'}</span></a>
        <div class="card__pad"><b style="font-size:15.5px">${esc(s.name)}</b><div class="muted" style="font-size:12px">${esc(s.title)}・掲載 ${ph.length}枚</div>
          <div class="grid2" style="margin-top:12px"><a class="btn btn--ink btn--sm" href="#/album/${s.token}?from=app">${icon('eye', 'sm')}開く</a><button class="btn btn--ghost btn--sm" data-share="${s.id}">${icon('share', 'sm')}URLを送る</button></div></div></div>`;
    }).join('')}</div>
    <p class="note" style="margin-top:14px">「是正」の写真や、アルバムから外した写真は、お客様には表示されません。台帳でいつでも切り替えられます。</p>
  </div>`;
  return {
    title: '工事アルバム', sub: 'お客様にURLでお届け', backTo: '#/', html,
    mount(root) { root.addEventListener('click', (e) => { const b = e.target.closest('[data-share]'); if (b) shareAlbum(b.dataset.share); }); },
  };
}

function shareAlbum(id) {
  const s = site(id); const url = albumUrl(s);
  const msg = `${s.name.replace(/^.*\s/, '')} ご担当者様\n西島塗装です。工事の様子を写真でまとめました。下のURLからご覧いただけます。\n${url}`;
  sheet(`<div class="sheet__title">お客様にURLを送る</div><div class="sheet__sub">LINEやメールにそのまま貼り付けられる文面です。</div>
    <div class="qrbox">${qrSvg(url, 5)}</div>
    <div class="card card__pad" style="margin-top:12px;white-space:pre-wrap;font-size:13.5px">${esc(msg)}</div>
    <div class="grid2" style="margin-top:12px"><button class="btn btn--ghost" id="sh-copy">${icon('copy')}文面をコピー</button><button class="btn btn--primary" id="sh-share">${icon('share')}LINEなどで送る</button></div>`, {
    onOpen(el) {
      el.querySelector('#sh-copy').addEventListener('click', () => copyText(msg).then(() => toast('コピーしました')));
      el.querySelector('#sh-share').addEventListener('click', async () => {
        if (navigator.share) { try { await navigator.share({ title: `${s.name} 工事アルバム`, text: msg }); } catch (e) {} }
        else window.open(`https://line.me/R/msg/text/?${encodeURIComponent(msg)}`, '_blank', 'noopener');
      });
    },
  });
}

// ---------- 工事アルバム（お客様が見る画面） ----------
export function albumView(q, token) {
  const s = S.sites.find((x) => x.token === token);
  if (!s) return { bare: true, html: `<div class="alb"><div class="alb__sec" style="text-align:center;padding-top:30vh">${mark(48)}<h2>このアルバムは見つかりませんでした</h2><p class="lead">URLをもう一度ご確認ください。</p></div></div>` };
  const k = kindOf(s);
  const ph = photosOf(s.id).filter((p) => p.flags?.album !== false && !stepOf(s, p.step)?.internal);
  const by = (stepK) => ph.filter((p) => p.step === stepK);
  const before = by(k.steps[0].k);
  const done = by('done');
  const heroP = done[0] || ph[ph.length - 1] || before[0];
  const coatSteps = k.steps.filter((x) => x.coat);
  const coatPh = coatSteps.map((st) => { const l = by(st.k); return { st, p: l.find((x) => x.part === k.coatParts[0]) || l[0] }; });
  const showCoat = coatPh.filter((c) => c.p).length >= 2;
  const cur = s.status === 'active' ? currentStep(s.id) : null;
  const leader = worker(s.crew[0]);
  const fromApp = q.from === 'app';
  const range = `${fmtDate(s.start, false)} 〜 ${s.status === 'done' ? fmtDate(s.end, false) : '施工中'}`;

  const timeline = k.steps.filter((st) => !st.internal).map((st) => {
    const l = by(st.k); if (!l.length) return '';
    return `<div class="atl__item rise" style="--c:${st.c}"><span class="atl__dot"></span><div class="atl__date">${fmtYmd(l[0].at)}</div><h3>${esc(st.l)}</h3><p>${esc(st.why)}</p>
      <div class="atl__ph">${l.slice(0, 6).map((p) => imgTag(p, 'f', `data-zoom="${p.id}"`)).join('')}</div></div>`;
  }).join('');

  const html = `<div class="alb">
    <header class="alb__hero">${imgTag(heroP, 'f')}
      <div class="alb__brand">${mark(30)}<b>${COMPANY.short}</b></div>
      <div class="alb__heroin"><div class="eyebrow" style="color:#ffb084">CONSTRUCTION ALBUM</div>
        <h1>${esc(s.name)}<br>${esc(s.title)}</h1><p>${range}<br>工事の様子を、工程ごとにお届けします。</p></div></header>

    ${cur ? `<section class="alb__sec" style="padding-bottom:0"><div class="card card__pad" style="box-shadow:var(--shadow-2)"><div class="eyebrow">NOW</div><h2 style="margin:6px 0 4px;font-size:22px">ただいま「${esc(cur.l)}」を施工中です</h2>${stepperHtml(s.id)}<p class="note" style="margin-top:8px">写真が届くたびに、このページは自動で新しくなります。</p></div></section>` : ''}

    <section class="alb__sec"><div class="eyebrow">OVERVIEW</div><h2>工事の概要</h2>
      <p class="lead">${esc(s.memo || '')}</p>
      <dl class="spec"><dt>工事内容</dt><dd>${esc(s.title)}（${esc(k.label)}）</dd><dt>工期</dt><dd>${range}</dd>
        ${Object.entries(s.paint || {}).map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}
        <dt>担当</dt><dd><div class="row">${avatar(leader)}<span>${esc(leader.full)}（${esc(leader.note)}）ほか自社職人</span></div></dd></dl></section>

    ${done.length && before.length ? `<section class="alb__sec alb__sec--paper"><div class="eyebrow">BEFORE / AFTER</div><h2>塗る前と、塗った後</h2><p class="lead" style="margin-bottom:18px">つまみを左右に動かしてご覧ください。</p>${baHtml(imgSrc(before[0], 'f'), imgSrc(done[0], 'f'), '着工前', '完成')}</section>` : ''}

    ${showCoat ? `<section class="alb__sec alb__sec--ink"><div class="eyebrow">${k.coatParts.length > 1 ? '3 COATS' : '3 LAYERS'}</div>
      <h2>見えなくなる工程こそ、<br>いちばん丁寧に。</h2>
      <p class="lead">${s.kind === 'water' ? '防水は、層を重ねて決められた厚みをつくります。完成すると見えなくなる各層の様子を残しています。' : '外壁も屋根も、下塗り・中塗り・上塗りの3回塗りです。完成すると見えなくなる下塗りと中塗りの写真も、すべて残しています。'}</p>
      <div class="coats3">${coatPh.map(({ st, p }) => `<figure><div class="bar" style="background:${st.c === '#111317' ? '#fffdf8' : st.c}"></div><div class="im">${p ? imgTag(p, 'f') : ''}<span>${esc(st.l)}</span></div><figcaption>${esc(st.why)}</figcaption></figure>`).join('')}</div></section>` : ''}

    <section class="alb__sec"><div class="eyebrow">PROCESS</div><h2>工事の流れ</h2><p class="lead">撮影日と、それぞれの工程で何をしたかをまとめています。</p>
      <div class="atl">${timeline}</div></section>

    <section class="alb__sec alb__sec--paper review"><div class="eyebrow" style="justify-content:center">REVIEW</div><h2>工事はいかがでしたか？</h2>
      <p class="lead">いただいたお声は、職人一同の励みになります。<br>よろしければ、Googleマップへのご感想もお願いいたします。</p>
      <div class="stars" id="al-stars">${[1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" aria-label="${n}つ星">${starFill()}</button>`).join('')}</div>
      <textarea class="textarea" id="al-text" style="max-width:520px;margin:6px auto 12px;display:block" placeholder="例）近所へのあいさつも丁寧で、工事中の様子が写真で分かって安心でした。"></textarea>
      <button class="btn btn--primary" id="al-send" style="min-width:260px">${icon('heart')}感想を送る</button>
      <p class="note" style="margin-top:12px">送信後、Googleマップの口コミ画面が開きます（任意です）。</p></section>

    <footer class="alb__foot">${mark(40)}<b>${COMPANY.name}</b>${esc(COMPANY.addr)}<br>TEL ${COMPANY.tel}<br>${esc(COMPANY.license)}<br><br>
      <span style="opacity:.6">このページは、${esc(s.name)}様のための専用ページです。URLを知っている方だけがご覧になれます。</span></footer>
    ${fromApp ? `<div class="alb__demo"><a class="btn btn--ink" href="#/site/${s.id}">${icon('back', 'sm')}アプリに戻る</a><button class="btn btn--primary" id="al-share">${icon('share', 'sm')}URLを送る</button></div>` : ''}
  </div>`;
  return {
    bare: true, html, live: true,
    mount(root) {
      bindBA(root);
      let stars = 0;
      root.querySelector('#al-stars').addEventListener('click', (e) => {
        const b = e.target.closest('[data-star]'); if (!b) return; stars = Number(b.dataset.star);
        root.querySelectorAll('#al-stars button').forEach((x, i) => x.classList.toggle('on', i < stars));
      });
      root.querySelector('#al-send').addEventListener('click', () => {
        if (!stars) { toast('星の数を選んでください', 'warn'); return; }
        const r = { id: uid('v'), site: s.id, stars, text: root.querySelector('#al-text').value.trim(), at: new Date().toISOString() };
        S.reviews.push(r); commit('review');
        if (remoteOn()) enqueue('addReview', { review: r });
        toast('ありがとうございました！');
        if (stars >= 4) setTimeout(() => window.open(COMPANY.reviewUrl, '_blank', 'noopener'), 900);
        root.querySelector('#al-send').disabled = true;
      });
      root.querySelector('#al-share')?.addEventListener('click', () => shareAlbum(s.id));
      root.addEventListener('click', (e) => {
        const z = e.target.closest('[data-zoom]'); if (!z) return;
        const p = S.photos.find((x) => x.id === z.dataset.zoom);
        const ov = document.createElement('div'); ov.className = 'viewer'; ov.style.gridTemplateColumns = '1fr'; ov.style.gridTemplateRows = 'auto 1fr';
        ov.innerHTML = `<div class="viewer__top"><button class="iconbtn" aria-label="閉じる">${icon('close')}</button><b style="font-size:14px">${esc(stepOf(s, p.step).l)}・${fmtYmd(p.at)}</b></div><div class="viewer__img">${imgTag(p, 'f')}</div>`;
        ov.addEventListener('click', () => ov.remove()); document.body.appendChild(ov); hydrate(ov);
      });
    },
  };
}

// ---------- 発信の下書き（PLAN A） ----------
const CH = [
  { k: 'hp', l: 'ホームページ', ic: 'doc' },
  { k: 'ig', l: 'Instagram', ic: 'insta' },
  { k: 'gbp', l: 'Googleマップ', ic: 'map' },
  { k: 'job', l: '求人・職人紹介', ic: 'job' },
];

export function writerView(q) {
  const sites = S.sites.filter((s) => photosOf(s.id).length >= 3);
  const sid = q.site && site(q.site) ? q.site : (sites.find((s) => s.status === 'done') || sites[0]).id;
  const s = site(sid);
  const ch = q.ch || 'hp';
  const d = S.drafts[sid];
  const pick = mediaFor(s);
  const html = `<div class="page page--wide">
    <div class="ai rise"><h2>写真から、発信の下書きをつくる</h2>
      <p>現場で撮った写真と工程の記録から、ホームページ・Instagram・Googleマップ・求人の文章を一度に作ります。確認して「投稿」を押すだけです。</p>
      <div class="flow"><span>${icon('camera', 'sm')} 工程ごとの写真</span>${icon('chev')}<span>${icon('spark', 'sm')} AIが下書き</span>${icon('chev')}<span>スマホで確認</span>${icon('chev')}<span>投稿</span></div></div>
    <div class="sec"><div class="sec__head"><span class="en">SITE</span><h2>どの現場の発信を作りますか</h2></div>
      <div class="chips chips--scroll" style="margin-top:0">${sites.map((x) => `<a class="chip ${x.id === sid ? 'on' : ''}" href="#/writer?site=${x.id}">${esc(x.name)}${S.drafts[x.id] ? ' <span class="cnt">済</span>' : ''}</a>`).join('')}</div></div>
    <div class="card card__pad" style="margin-top:6px">
      <div class="row row--between"><b style="font-size:14px">使う写真（${pick.length}枚・この順に並べます）</b><a class="link" href="#/ledger?site=${sid}" style="font-size:12.5px;color:var(--orange);font-weight:700">写真を選び直す</a></div>
      <div class="draft__media" style="margin:10px -18px 0">${pick.map((p, i) => `<figure><span class="n">${i + 1}</span>${imgTag(p)}<figcaption>${esc(stepOf(s, p.step).l)}</figcaption></figure>`).join('')}</div>
      ${!d ? `<button class="btn btn--primary btn--block" style="margin-top:14px" data-w="gen">${icon('spark')}下書きを作る（4種類）</button>` : ''}
    </div>
    ${d ? `<div class="sec"><div class="dtabs">${CH.map((c) => `<a class="dtab ${ch === c.k ? 'on' : ''}" href="#/writer?site=${sid}&ch=${c.k}">${icon(c.ic, 'sm')}${c.l}${d.ok && d.ok[c.k] ? '<span class="ok"></span>' : ''}</a>`).join('')}</div>
      <div class="draft" style="margin-top:12px" id="draft">${draftBody(s, ch, pick, false)}</div></div>` : '<div id="draft"></div>'}
    <p class="note" style="margin-top:14px">デモでは、工程の記録をもとにした定型の組み立てで文章を作っています。本番は生成AI（Gemini）が、御社の言葉づかい（まごころ・3回塗り・近隣への配慮）で書きます。投稿は必ず人が確認してから行います。</p>
  </div>`;
  return {
    title: '発信の下書き', sub: 'ブログ・Instagram・Googleマップ', backTo: '#/', html,
    mount(root) {
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-w]'); if (!b) return;
        if (b.dataset.w === 'gen') generate(root, s, pick);
        if (b.dataset.w === 'copy') { copyText(plain(s, ch, pick)).then(() => toast('コピーしました。そのまま貼り付けられます')); }
        if (b.dataset.w === 'ok') { const dd = S.drafts[sid]; dd.ok = dd.ok || {}; dd.ok[ch] = true; commit('draft'); toast('確認済みにしました'); rerender(); }
        if (b.dataset.w === 'redo') { delete S.drafts[sid]; commit('draft'); rerender(); setTimeout(() => document.querySelector('[data-w="gen"]')?.click(), 100); }
      });
    },
  };
}

function mediaFor(s) {
  const k = kindOf(s); const ph = photosOf(s.id).filter((p) => p.flags?.album !== false && !stepOf(s, p.step)?.internal);
  const out = [];
  const want = s.kind === 'water' ? ['before', 'remove', 'sheet', 'layer1', 'layer2', 'top', 'done'] : ['before', 'wash', 'repair', 'coat1', 'coat2', 'coat3', 'trim', 'done'];
  for (const st of want) { const l = ph.filter((p) => p.step === st); const star = l.find((p) => p.flags?.post); if (l.length) out.push(star || l[0]); }
  if (!out.length) return ph.slice(0, 6);
  return out.slice(0, 10);
}

function area(s) { return (s.place || '').replace(/^(玉名郡|荒尾市|玉名市)/, (m) => m) || '玉名市'; }

// 下書きを「見出し・本文・ハッシュタグ」の塊で組み立てる
function blocks(s, ch, pick) {
  const k = kindOf(s);
  const ph = photosOf(s.id);
  const ar = (s.place || '玉名市').replace('玉名郡', '');
  const name = s.name.replace(s.place || '', '').trim() || s.name;
  const done = s.status === 'done';
  const leader = worker(s.crew[0]); const crew = s.crew.map((w) => worker(w));
  const isW = s.kind === 'water';
  const method = isW ? 'ウレタン防水の通気緩衝工法' : '下塗り・中塗り・上塗りの3回塗り';
  const paints = Object.entries(s.paint || {}).map(([a, b]) => `${a}：${b}`);
  const stepsDone = k.steps.filter((st) => !st.internal && ph.some((p) => p.step === st.k));
  const noteOf = (st) => ph.filter((p) => p.step === st.k && p.note).map((p) => p.note).slice(0, 2).join('。');
  if (ch === 'hp') {
    const out = [{ t: 'h3', s: `【${ar}】${name}｜${s.title}　${method}で${done ? '仕上げました' : '施工中です'}` }];
    out.push({ t: 'p', s: `${s.memo || ''} ${done ? '' : '現在も工事を進めています。'}今回は${leader.full}（${leader.note}）を中心に、自社の職人で施工しました。` });
    stepsDone.forEach((st) => {
      const n = ph.filter((p) => p.step === st.k).length;
      const nt = noteOf(st);
      out.push({ t: 'h', s: `■ ${st.l}` }, { t: 'p', s: `${st.why}${nt ? `（現場メモ：${nt}）` : ''}［写真${n}枚］` });
    });
    if (paints.length) out.push({ t: 'h', s: '■ 使用した材料' }, { t: 'p', s: paints.join('\n') });
    out.push({ t: 'p', s: `\n${COMPANY.areas.slice(0, 5).join('・')}周辺で外壁塗装・屋根塗装・防水工事をご検討の方は、${COMPANY.short}へお気軽にご相談ください。現地調査・お見積りは無料です。（TEL ${COMPANY.tel}）` });
    return out;
  }
  if (ch === 'ig') {
    return [
      { t: 'p', s: `【${ar}】${s.title}${done ? ' 完成しました✨' : ' 進んでいます🎨'}` },
      { t: 'p', s: `\n${isW ? '雨漏りから建物を守る防水層。通気緩衝シートで膨れを防ぎ、ウレタンを重ねて仕上げました。' : '見えなくなる下塗りこそ、いちばん丁寧に。\n下塗り・中塗り・上塗りの3回塗りで仕上げています。'}` },
      { t: 'p', s: `\n📷 ${pick.length}枚の並び\n${pick.map((p, i) => `${i + 1}. ${stepOf(s, p.step).l}`).join(' → ')}` },
      { t: 'p', s: `\n▼工程\n${stepsDone.map((st) => `✔ ${st.l}`).join('\n')}` },
      { t: 'p', s: `\n職人歴32年の工事長をはじめ、自社の職人が施工しています。\n${COMPANY.areas.slice(0, 4).join('・')}の塗装・防水は${COMPANY.short}へ\n📞 ${COMPANY.tel}` },
      { t: 'tags', s: `\n#${ar} #${isW ? '屋上防水 #防水工事 #ウレタン防水' : '外壁塗装 #屋根塗装 #塗り替え'} #${COMPANY.short} #熊本の塗装屋さん #玉名市 #荒尾市 #長洲町 #ビフォーアフター #職人の仕事` },
    ];
  }
  if (ch === 'gbp') {
    return [
      { t: 'h', s: `${ar}で${s.title}が${done ? '完了しました' : '進んでいます'}` },
      { t: 'p', s: `${isW ? '既存防水の撤去・下地調整のあと、通気緩衝シートとウレタン防水を重ねて仕上げています。' : '高圧洗浄・下地補修のあと、下塗り・中塗り・上塗りの3回塗りで仕上げています。'}工事中の写真は、お客様専用の工事アルバムでご確認いただけます。外壁・屋根の塗り替え、防水のご相談は${COMPANY.short}へ。現地調査・お見積りは無料です。` },
      { t: 'p', s: '\n［ボタン：電話する］' },
    ];
  }
  // 求人・職人紹介
  return [
    { t: 'h3', s: `【職人の仕事】${name}の現場から` },
    { t: 'p', s: `今回は${s.title}。${crew.map((c) => `${c.full}（${c.note}）`).join('、')}が担当しました。` },
    { t: 'p', s: `${isW ? '屋上の防水は、材料の量と厚みの管理がすべて。クレーンで材料を揚げ、使う数量を確認してから、層を重ねていきます。' : '塗装は、塗る前の準備で仕上がりが決まります。高圧洗浄・下地補修・養生を丁寧に積み上げてから、3回塗りに入ります。'}` },
    { t: 'p', s: `\n${COMPANY.short}では、未経験から1級塗装技能士をめざせる環境で、一緒に「街の色を守る」仲間を募集しています。現場見学も歓迎です。` },
    { t: 'tags', s: '\n#塗装工 #職人募集 #玉名市 #熊本求人 #未経験歓迎' },
  ];
}
function plain(s, ch, pick) { return blocks(s, ch, pick).map((b) => b.s).join('\n'); }
function blockHtml(b, text) {
  if (b.t === 'h3') return `<h3>${esc(text)}</h3>`;
  if (b.t === 'h') return `<span class="h">${esc(text)}</span>`;
  if (b.t === 'tags') return `<span class="ht">${esc(text)}</span>`;
  return `<span>${esc(text)}</span>\n`;
}
function draftBody(s, ch, pick, typing) {
  const bl = blocks(s, ch, pick);
  const n = plain(s, ch, pick).length;
  const d = S.drafts[s.id] || {};
  const media = ch === 'gbp' ? pick.slice(-1) : ch === 'job' ? pick.slice(2, 5) : ch === 'hp' ? pick : pick;
  return `<div class="draft__media">${media.map((p, i) => `<figure><span class="n">${i + 1}</span>${imgTag(p)}<figcaption>${esc(stepOf(s, p.step).l)}</figcaption></figure>`).join('')}</div>
    <div class="draft__text" id="dt">${typing ? '' : bl.map((b) => blockHtml(b, b.s)).join('')}</div>
    <div class="draft__meta"><span>${n}文字</span>${ch === 'gbp' ? `<span class="tag ${n <= 1500 ? 'tag--g' : 'tag--r'}">上限1500文字以内</span>` : ''}${ch === 'ig' ? '<span class="tag tag--b">ハッシュタグ 12個</span>' : ''}
      <span>作成 ${d.at ? fmtYmd(d.at) : ''}</span>
      <button class="btn btn--ghost btn--sm" data-w="redo">${icon('refresh', 'sm')}作り直す</button>
      <button class="btn btn--ghost btn--sm" data-w="copy">${icon('copy', 'sm')}コピー</button>
      <button class="btn ${d.ok && d.ok[ch] ? 'btn--soft' : 'btn--primary'} btn--sm" data-w="ok">${icon('check', 'sm')}${d.ok && d.ok[ch] ? '確認済み' : '確認済みにする'}</button></div>`;
}

async function generate(root, s, pick) {
  const box = root.querySelector('#draft');
  const btn = root.querySelector('[data-w="gen"]'); if (btn) btn.remove();
  const stages = ['写真を工程の順に並べています…', '現場メモと使用材料を読み取っています…', '御社の言葉づかいで文章を書いています…'];
  box.className = 'draft'; box.style.marginTop = '14px';
  for (const t of stages) {
    box.innerHTML = `<div class="row" style="gap:10px;font-weight:700">${icon('spark')}<span>${t}</span></div><div class="shimmer" style="width:92%"></div><div class="shimmer" style="width:78%"></div><div class="shimmer" style="width:85%"></div>`;
    await new Promise((r) => setTimeout(r, 620));
  }
  S.drafts[s.id] = { at: new Date().toISOString(), ok: {}, posted: false }; commit('draft');
  box.innerHTML = `<div class="dtabs" style="margin:0 -18px 12px;padding:0 18px">${CH.map((c, i) => `<span class="dtab ${i === 0 ? 'on' : ''}">${icon(c.ic, 'sm')}${c.l}</span>`).join('')}</div>${draftBody(s, 'hp', pick, true)}`;
  hydrate(box);
  const dt = box.querySelector('#dt');
  const bl = blocks(s, 'hp', pick);
  let html = '';
  for (const b of bl) {
    let shown = '';
    for (let i = 0; i < b.s.length; i += 3) {
      shown = b.s.slice(0, i + 3);
      dt.innerHTML = html + blockHtml(b, shown) + '<span class="caret"></span>';
      await new Promise((r) => requestAnimationFrame(r));
    }
    html += blockHtml(b, b.s);
  }
  dt.innerHTML = html;
  toast('4種類の下書きができました（ホームページ・Instagram・Googleマップ・求人）');
  setTimeout(() => go(`#/writer?site=${s.id}&ch=hp`), 900);
}
