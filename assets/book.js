/* 当下的力量 · 阅读站
 * 主题 / 进度 / 目录抽屉 / 朗读 / 摘录 / 练习作答
 * 所有数据留在本机 localStorage，命名空间 nvc:*
 */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const D = document.body.dataset;
  const CH = D.ch || '';
  const PAGE = D.page || '';

  /* 空状态：细线纸页 + 书签，和全站纸感同源；颜色跟随主题 */
  const EMPTY_ART = '<svg viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20 9h25l8 8v46H20z"/><path d="M45 9v9h8"/>' +
    '<path d="M27 29h18M27 36h18M27 43h12"/>' +
    '<path d="M35 43v13l4-3 4 3V43" stroke-width="1.3"/></svg>';

  const store = {
    get(k, d) { try { const v = localStorage.getItem('pow:' + k); return v == null ? d : JSON.parse(v) } catch (e) { return d } },
    set(k, v) { try { localStorage.setItem('pow:' + k, JSON.stringify(v)); return true } catch (e) { return false } },
  };

  /* ---------- 主题 ---------- */
  const themeBtn = $('#theme');
  const applyTheme = t => {
    document.documentElement.dataset.theme = t;
    if (themeBtn) themeBtn.textContent = t === 'dark' ? '☾' : '☀';
  };
  applyTheme(store.get('theme', matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'));
  if (themeBtn) themeBtn.onclick = () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(t); store.set('theme', t);
  };

  /* ---------- 字号：三档，跟着正文一起缩放 ---------- */
  const FSS = [16, 18, 20, 22];
  const applyFs = px => {
    document.documentElement.style.setProperty('--fs', px + 'px');
    $$('.fsbtn').forEach(b => b.classList.toggle('on', +b.dataset.fs === (FSS.indexOf(px) - 1)));
  };
  applyFs(FSS.includes(store.get('fs', 18)) ? store.get('fs', 18) : 18);
  const stepFs = step => {
    const i = FSS.indexOf(parseInt(getComputedStyle(document.body).fontSize, 10));
    const next = step === 0 ? 1 : Math.max(0, Math.min(FSS.length - 1, (i < 0 ? 1 : i) + step));
    applyFs(FSS[next]); store.set('fs', FSS[next]);
    return FSS[next];
  };
  $$('.fsbtn').forEach(b => b.onclick = () => stepFs(+b.dataset.fs));
  const fsTop = $('#fsbtn');
  if (fsTop) fsTop.onclick = () => {
    const px = stepFs(1);
    if (px === FSS[FSS.length - 1]) stepFs(-(FSS.length - 1)); /* 到最大后回到 16 */
    toast('字号 ' + parseInt(getComputedStyle(document.body).fontSize, 10) + 'px');
  };

  /* ---------- 阅读进度条 ---------- */
  const bar = $('#progress');
  if (bar) {
    const paint = () => {
      const h = document.documentElement;
      const p = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
      bar.style.width = (p * 100).toFixed(2) + '%';
    };
    addEventListener('scroll', paint, { passive: true });
    addEventListener('resize', paint);
    paint();
  }

  /* ---------- 顶栏高度 ---------- */
  const topEl = $('.top');
  const syncTop = () => {
    if (topEl) document.documentElement.style.setProperty('--top-h', topEl.offsetHeight + 'px');
  };
  syncTop();
  addEventListener('resize', syncTop);

  /* ============================================================
     朗读：Web Speech API
     按「块 → 句」两级排队。每句一个 utterance，避免 iOS 长文本被截断；
     高亮落在块上（不改写 DOM 结构），自动滚到视野中央。
     ============================================================ */
  const Speak = (() => {
    const synth = window.speechSynthesis;
    if (!synth) return { ok: false };

    let units = [];          // [{el, text}]
    let idx = 0;
    let playing = false;
    let speed = store.get('spd', 1);
    let voice = null;
    let cur = null;

    const pickVoice = () => {
      const vs = synth.getVoices() || [];
      return vs.find(v => /zh[-_]CN/i.test(v.lang) && /Ting|Xiao|Yaoyao|Huihui|Mei|female|女/i.test(v.name))
        || vs.find(v => /zh[-_]CN/i.test(v.lang))
        || vs.find(v => /^zh/i.test(v.lang))
        || null;
    };
    const initVoice = () => { voice = pickVoice(); };
    initVoice();
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = initVoice;

    /* 句子切分：先按句末标点，过长的再按逗号/分号切 */
    function splitSentences(t) {
      t = t.replace(/\s+/g, ' ').trim();
      if (!t) return [];
      const out = [];
      let buf = '';
      for (let i = 0; i < t.length; i++) {
        buf += t[i];
        const c = t[i];
        if ('。！？!?…'.includes(c) || (c === '；' && buf.length > 40)) {
          if (buf.trim()) out.push(buf.trim());
          buf = '';
        }
      }
      if (buf.trim()) out.push(buf.trim());
      // 超长句再拆
      const fine = [];
      for (const s of out) {
        if (s.length <= 110) { fine.push(s); continue }
        let b = '';
        for (let i = 0; i < s.length; i++) {
          b += s[i];
          if (i > 0 && ('，、：,'.includes(s[i])) && b.length >= 55) { fine.push(b); b = '' }
        }
        if (b.trim()) fine.push(b);
      }
      return fine;
    }

    function collect() {
      const root = $('#content');
      if (!root) return [];
      const sel = 'p, .qa-a p, .qa-qt, blockquote.gold, .poem p, li';
      const els = $$(sel, root).filter(el => !el.closest('.ansr'));
      const list = [];
      els.forEach(el => {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (!t) return;
        if (el.classList.contains('src')) return;
        splitSentences(t).forEach(s => list.push({ el, text: s }));
      });
      return list;
    }

    const hl = el => {
      $$('.speaking').forEach(e => e.classList.remove('speaking'));
      if (el) el.classList.add('speaking');
    };

    function speakAt(i) {
      if (i >= units.length) { stop(true); return }
      idx = i;
      const u = units[i];
      hl(u.el);
      if (u.el.scrollIntoView) {
        const r = u.el.getBoundingClientRect();
        if (r.top < 90 || r.bottom > innerHeight - 90) {
          u.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
      const ut = new SpeechSynthesisUtterance(u.text);
      ut.lang = 'zh-CN';
      ut.rate = speed;
      ut.pitch = 1;
      if (voice) ut.voice = voice;
      ut.onend = () => { if (playing) speakAt(i + 1) };
      ut.onerror = e => {
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        if (playing) speakAt(i + 1);
      };
      cur = ut;
      synth.speak(ut);
      paint();
    }

    function start(fromEl) {
      units = collect();
      if (!units.length) return;
      let i = 0;
      if (fromEl) {
        const k = units.findIndex(u => u.el === fromEl || u.el.contains(fromEl));
        if (k >= 0) i = k;
      }
      playing = true;
      if (synth.speaking || synth.pending) synth.cancel();
      speakAt(i);
      paint();
    }

    function pause() {
      playing = false;
      synth.cancel();
      paint();
    }
    function resume() {
      if (!units.length) { start(); return }
      playing = true;
      speakAt(idx);
    }
    function stop(silent) {
      playing = false;
      synth.cancel();
      $$('.speaking').forEach(e => e.classList.remove('speaking'));
      if (!silent) paint();
      else paint();
    }
    function next() { if (!units.length) return; playing = true; speakAt(Math.min(idx + 1, units.length - 1)) }
    function prev() { if (!units.length) return; playing = true; speakAt(Math.max(idx - 1, 0)) }

    /* --- 播放条 --- */
    let ui = null;
    function buildUI() {
      if (ui) return ui;
      ui = document.createElement('div');
      ui.className = 'speak';
      ui.innerHTML =
        '<button class="sp-play" aria-label="播放">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true" class="ic-play"><path d="M8 4.9v14.2L18.8 12z"/></svg>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true" class="ic-pause" style="display:none"><path d="M7 4.6h3.5v14.8H7zM13.5 4.6H17v14.8h-3.5z"/></svg>' +
        '</button>' +
        '<div class="sp-main"><div class="sp-top"><span class="sp-state">朗读</span><b class="sp-n">0/0</b></div>' +
        '<div class="sp-txt"></div></div>' +
        '<button class="sp-btn sp-prev" aria-label="上一句">‹</button>' +
        '<button class="sp-btn sp-next" aria-label="下一句">›</button>' +
        '<button class="sp-spd" aria-label="语速"></button>';
      document.body.appendChild(ui);

      $('.sp-play', ui).onclick = () => { playing ? pause() : (units.length ? resume() : start()) };
      $('.sp-prev', ui).onclick = prev;
      $('.sp-next', ui).onclick = next;
      const spd = $('.sp-spd', ui);
      const steps = [0.8, 1, 1.2, 1.5];
      spd.textContent = (speed === 1 ? '1' : String(speed)) + '×';
      spd.onclick = () => {
        const i = steps.indexOf(speed);
        speed = steps[(i + 1) % steps.length];
        store.set('spd', speed);
        spd.textContent = (speed === 1 ? '1' : String(speed)) + '×';
        if (playing) { synth.cancel(); speakAt(idx) }
      };
      return ui;
    }

    function paint() {
      if (!ui) return;
      ui.classList.add('on');
      const p = $('.ic-play', ui), q = $('.ic-pause', ui);
      if (p) p.style.display = playing ? 'none' : '';
      if (q) q.style.display = playing ? '' : 'none';
      const n = $('.sp-n', ui), tx = $('.sp-txt', ui), st = $('.sp-state', ui);
      if (n) n.textContent = units.length ? ((playing || idx ? idx + 1 : 0) + ' / ' + units.length) : '';
      if (st) st.textContent = playing ? '朗读中' : (units.length ? '已暂停' : '朗读');
      if (tx) tx.textContent = units[idx] ? units[idx].text.slice(0, 28)
        : '点段落开始读';
    }

    /* 点段落即从该段开始 */
    function bindTap(root) {
      root.addEventListener('click', e => {
        if (e.target.closest('a,button,textarea,.ansr,.dtoc')) return;
        const sel = window.getSelection();
        if (sel && String(sel).trim().length > 2) return;
        const el = e.target.closest('#content p, #content .qa, #content blockquote.gold, #content li');
        if (!el) return;
        buildUI();
        start(el);
      });
    }

    return {
      ok: true,
      show() { buildUI(); ui.classList.add('on'); paint() },
      toggle() {
        buildUI();
        if (playing) pause();
        else if (units.length) resume();
        else start();
      },
      start, pause, resume, stop, next, prev, bindTap, buildUI, paint,
      isPlaying: () => playing,
    };
  })();

  /* 顶栏朗读按钮 */
  const spBtn = $('#speak');
  if (spBtn) {
    if (!Speak.ok || PAGE !== 'chapter') { spBtn.hidden = true }
    else spBtn.onclick = () => Speak.toggle();
  }
  if (Speak.ok && PAGE === 'chapter') {
    Speak.bindTap($('#content') || document.body);
  }
  /* 朗读条不自动常驻，免得盖住正文；顶栏「朗读」或点任一段即可唤起 */

  /* ============================================================
     目录抽屉
     ============================================================ */
  const drawer = $('#drawer');
  if (drawer) {
    const open = () => { drawer.classList.add('on'); document.body.style.overflow = 'hidden' };
    const close = () => { drawer.classList.remove('on'); document.body.style.overflow = '' };
    $$('[data-open-drawer]').forEach(b => b.onclick = open);
    $$('[data-close-drawer]', drawer).forEach(b => b.onclick = close);
    const bd = $('.bd', drawer);
    if (bd) bd.onclick = close;
    addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('on')) close() });
    $$('a', drawer).forEach(a => a.addEventListener('click', () => setTimeout(close, 60)));

    /* 当前小节高亮 */
    const heads = $$('.sec-blk');
    const links = $$('.dtoc a[href^="#"]', drawer);
    if (heads.length && links.length) {
      const paintToc = () => {
        const y = (topEl ? topEl.offsetHeight : 52) + 40;
        let curId = '';
        heads.forEach(h => { if (h.getBoundingClientRect().top < y) curId = h.id });
        links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + curId));
      };
      addEventListener('scroll', paintToc, { passive: true });
      paintToc();
    }
  }

  /* ============================================================
     续读：记住每章的滚动位置，首页直达上次那一段
     ============================================================ */
  const jumpTo = y => {
    const h = document.documentElement, old = h.style.scrollBehavior;
    h.style.scrollBehavior = 'auto';       /* CSS 的 smooth 会连 scrollTop 赋值也变平滑 */
    h.scrollTop = y; document.body.scrollTop = y;
    requestAnimationFrame(() => { h.style.scrollBehavior = old });
  };
  if (PAGE === 'chapter' && CH) {
    const key = 'pos:' + CH;
    const saved = store.get(key, 0);
    let tm = 0;
    const save = () => store.set(key, Math.round(scrollY));
    addEventListener('scroll', () => { clearTimeout(tm); tm = setTimeout(save, 250) }, { passive: true });
    addEventListener('pagehide', save);
    const back = $('#toc-resume');
    if (back && saved > 200) back.hidden = false;
    if (back) back.onclick = () => {
      jumpTo(saved);
      history.replaceState(null, '', location.pathname + location.search);
    };
    if (location.hash === '#resume' && saved > 200) {
      requestAnimationFrame(() => jumpTo(saved));
      addEventListener('load', () => { if (Math.abs(scrollY - saved) > 120) jumpTo(saved) }, { once: true });
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  /* 原书表格：点图放大（手机上表格原尺寸太小） */
  if ($('.bookfig img')) {
    const ov = document.createElement('div');
    ov.className = 'zoomov';
    ov.innerHTML = '<button class="zclose" aria-label="关闭">✕</button><img alt="">';
    document.body.appendChild(ov);
    const big = $('img', ov);
    const close = () => { ov.classList.remove('on'); document.body.style.overflow = ''; big.removeAttribute('src') };
    $$('.bookfig img').forEach(i => i.onclick = () => {
      big.src = i.currentSrc || i.src; big.alt = i.alt;
      ov.classList.add('on'); document.body.style.overflow = 'hidden';
    });
    $('.zclose', ov).onclick = close;
    ov.onclick = e => { if (e.target === ov) close() };
    addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('on')) close() });
  }

  /* ============================================================
     摘录
     ============================================================ */
  const NOTES_KEY = 'notes';
  const getNotes = () => store.get(NOTES_KEY, []);
  const setNotes = v => store.set(NOTES_KEY, v);

  const selbar = $('#selbar');
  if (selbar && PAGE === 'chapter') {
    let pending = null;
    const hide = () => selbar.classList.remove('on');

    const show = rect => {
      selbar.classList.add('on');
      const w = selbar.offsetWidth, h = selbar.offsetHeight;
      let x = rect.left + rect.width / 2 - w / 2;
      let y = rect.top - h - 10;
      if (y < 60) y = rect.bottom + 10;
      selbar.style.left = Math.max(10, Math.min(innerWidth - w - 10, x)) + 'px';
      selbar.style.top = Math.max(56, y) + 'px';
    };

    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { hide(); return }
      const txt = String(sel).trim();
      if (txt.length < 4) { hide(); return }
      const node = sel.anchorNode;
      const host = node && (node.nodeType === 3 ? node.parentElement : node);
      if (!host || !host.closest('#content')) { hide(); return }
      if (host.closest('.ansr')) { hide(); return }
      pending = { txt, sec: host.closest('.sec-blk') };
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width || r.height) show(r);
    });

    $('[data-act="save-note"]', selbar).onclick = () => {
      if (!pending) return;
      const secEl = pending.sec;
      const secTitle = secEl ? ($('.h2t', secEl) ? $('.h2t', secEl).textContent.trim() : '') : '';
      const n = getNotes();
      n.unshift({
        q: pending.txt,
        ch: CH,
        chTitle: D.title || '',
        sec: secTitle,
        at: Date.now(),
      });
      setNotes(n.slice(0, 400));
      hide();
      getSelection().removeAllRanges();
      toast('已摘录');
    };
    $('[data-act="copy-note"]', selbar).onclick = () => {
      if (!pending) return;
      const t = pending.txt;
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('已复制'), () => toast('复制失败'));
      else toast('复制失败');
      hide();
    };
  }

  /* 摘录页 */
  const notesHost = $('#notes-list');
  if (notesHost) {
    const render = () => {
      const list = getNotes();
      if (!list.length) {
        notesHost.innerHTML = '<div class="empty">' + EMPTY_ART + '还没有摘录。<br>在正文里选中一段话，就会出现「摘录」按钮。</div>';
        return;
      }
      notesHost.innerHTML = list.map((n, i) => {
        const href = n.ch ? 'c/' + n.ch + '.html' : (n.page || '../index.html');
        return '<div class="note-item">' +
          '<p class="q">' + esc(n.q) + '</p>' +
          '<div class="from"><span>第 ' + (n.ch || '?') + ' 章 · ' + esc(n.sec || n.chTitle || '') + '</span>' +
          '<a href="' + href + '">回到原文</a>' +
          '<button class="del" data-i="' + i + '">删除</button></div></div>';
      }).join('');
      $$('.del', notesHost).forEach(b => b.onclick = () => {
        const l = getNotes(); l.splice(+b.dataset.i, 1); setNotes(l); render();
      });
    };
    render();
    const exp = $('#notes-export');
    if (exp) exp.onclick = () => {
      const t = getNotes().map(n => '> ' + n.q + '\n\n——第 ' + n.ch + ' 章 ' + (n.sec || '')).join('\n\n---\n\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([t], { type: 'text/markdown' }));
      a.download = '当下的力量-摘录.md';
      document.body.appendChild(a); a.click(); a.remove();
    };
  }

  /* ============================================================
     练习作答（小节标题以「练习」开头）
     ============================================================ */
  if (PAGE === 'chapter') {
    $$('.sec-blk').forEach((sec, si) => {
      const h = $('h2', sec);
      if (!h || !/^练习/.test(($('.h2t', h) || h).textContent.trim())) return;
      const key = CH + ':s' + (si + 1);
      const box = document.createElement('div');
      box.className = 'ansr';
      box.innerHTML = '<div class="lb">写在下面 · 只存在你的设备上</div><textarea placeholder="按书里的要求写出你的答案……"></textarea>';
      const ta = $('textarea', box);
      ta.value = store.get('ans:' + key, '');
      ta.oninput = () => store.set('ans:' + key, ta.value);
      sec.appendChild(box);
    });
  }

  /* ============================================================
     章末：标记读完 / 下一章
     ============================================================ */
  const markBtn = $('#markdone');
  if (markBtn && CH) {
    const key = 'read:' + CH;
    const cur = store.get(key, { done: false });
    const paint = () => {
      markBtn.classList.toggle('on', !!cur.done);
      markBtn.textContent = cur.done ? '✓ 已读' : '标记已读';
    };
    paint();
    markBtn.onclick = () => {
      cur.done = !cur.done;
      store.set(key, cur);
      paint();
      toast(cur.done ? '已标记读完' : '已取消');
    };
  }

  /* ============================================================
     首页：进度
     ============================================================ */
  if (PAGE === 'home') {
    const items = $$('.chs li[data-ch]');
    let done = 0;
    items.forEach(li => {
      const r = store.get('read:' + li.dataset.ch, { done: false });
      if (r.done) { li.classList.add('done'); done++ }
    });
    const pill = $('#homeprog');
    if (pill) pill.textContent = done + ' / ' + items.length;
    const ring = $('#homeringspan');
    if (ring) ring.style.width = (items.length ? done / items.length * 100 : 0) + '%';

    /* 继续阅读 */
    let last = null;
    items.forEach(li => {
      const r = store.get('read:' + li.dataset.ch, null);
      if (r && r.at && (!last || r.at > last.at)) last = { ch: li.dataset.ch, at: r.at, done: r.done, title: li.dataset.title };
    });
    const rb = $('#resume');
    if (rb && last) {
      rb.hidden = false;
      rb.href = 'c/' + last.ch + '.html#resume';
      rb.querySelector('.rt').textContent = '继续读第 ' + (+last.ch) + ' 章 · ' + last.title;
    }
  }

  /* 记录最近阅读时间 */
  if (PAGE === 'chapter' && CH) {
    const k = 'read:' + CH;
    const r = store.get(k, { done: false });
    r.at = Date.now();
    store.set(k, r);
    addEventListener('pagehide', () => { r.at = Date.now(); store.set(k, r) });
  }

  /* ============================================================
     全书检索
     ============================================================ */
  if (PAGE === 'search') {
    const input = $('#sq'), res = $('#sres'), cnt = $('#scount');
    let IDX = null, loading = false, failed = false;

    const load = () => {
      if (IDX) return Promise.resolve(IDX);
      if (loading) return loading;
      res.innerHTML = '<div class="empty">' + EMPTY_ART + '正在载入全书索引…</div>';
      loading = fetch('assets/search.json')
        .then(r => r.json())
        .then(d => { IDX = d; return d })
        .catch(() => { failed = true; IDX = []; return [] });
      return loading;
    };

    const mark = (t, terms) => {
      let out = esc(t);
      terms.forEach(k => {
        const re = new RegExp('(' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        out = out.replace(re, '<mark>$1</mark>');
      });
      return out;
    };

    const snippet = (t, terms) => {
      const low = t.toLowerCase();
      let at = -1;
      for (const k of terms) {
        const i = low.indexOf(k);
        if (i >= 0 && (at < 0 || i < at)) at = i;
      }
      if (at < 0) at = 0;
      const from = Math.max(0, at - 24);
      const to = Math.min(t.length, at + 76);
      return (from > 0 ? '…' : '') + t.slice(from, to) + (to < t.length ? '…' : '');
    };

    let tm = 0;
    const run = async () => {
      const q = input.value.trim();
      if (!q) {
        res.innerHTML = '<div class="empty">' + EMPTY_ART + '输入关键词开始检索</div>';
        cnt.textContent = '';
        return;
      }
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      const data = await load();
      if (failed) {
        res.innerHTML = '<div class="empty">' + EMPTY_ART + '索引没能载入。<br>检查网络后刷新页面再试。</div>';
        cnt.textContent = '';
        return;
      }
      const hit = data.filter(it => {
        const low = it.x.toLowerCase();
        return terms.every(k => low.includes(k));
      });
      cnt.textContent = hit.length ? hit.length + ' 段' : '无匹配';
      if (!hit.length) {
        res.innerHTML = '<div class="empty">' + EMPTY_ART + '没有找到包含「' + esc(q) + '」的段落。<br>试试只用一个词，或换一个说法。</div>';
        return;
      }
      const MAX = 120;
      res.innerHTML = hit.slice(0, MAX).map(it =>
        '<div class="sres-item"><div class="loc"><a href="c/' + it.c + '.html#' + it.s + '">'
        + '第' + (+it.c) + '章 ' + esc(it.ct) + (it.st ? ' · ' + esc(it.st) : '')
        + '</a></div><p class="txt">' + mark(snippet(it.x, terms), terms) + '</p></div>'
      ).join('') + (hit.length > MAX ? '<div class="empty">还有 ' + (hit.length - MAX) + ' 段，请把关键词写得更具体</div>' : '');
    };

    input.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(run, 160) });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(tm); run() } });
    /* 支持 ?q=关键词 直接进结果，链接可分享 */
    const q0 = new URLSearchParams(location.search).get('q');
    if (q0) input.value = q0;
    load().then(() => { if (input.value.trim()) run() });
  }

  /* ============================================================
     听书：引导页。朗读在各章内由 Web Speech API 完成。
     ============================================================ */
  /* 无预生成播放器，listen 页仅作引导，静态内容足够 */

  /* ---------- 小工具 ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  let toastEl = null, toastTm = 0;
  function toast(t) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:200;'
        + 'background:var(--fg);color:var(--bg);font-family:var(--sans);font-size:12.5px;'
        + 'padding:8px 16px;border-radius:999px;opacity:0;transition:opacity .2s;pointer-events:none';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = t;
    toastEl.style.opacity = '1';
    clearTimeout(toastTm);
    toastTm = setTimeout(() => { toastEl.style.opacity = '0' }, 1600);
  }

  /* 暴露给内联脚本 */
  window.POW = { store, toast, esc };
})();
