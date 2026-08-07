/* ============================================================
   app.js · 入口：开场时序 / 视图切换 / 控制条 / 键盘 / 面板
   ============================================================ */
'use strict';

const VERSION = '1.15.19';

/* ---------- Toast ---------- */
const Toast = {
  el: document.getElementById('toast'),
  timer: null,
  show(msg) {
    this.el.textContent = msg;
    this.el.hidden = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.el.hidden = true; }, 2600);
  }
};

/* ---------- UI 总控 ---------- */
const UI = {
  views: {
    intro: document.getElementById('view-intro'),
    player: document.getElementById('view-player'),
    catalog: document.getElementById('view-catalog')
  },
  controlbar: document.getElementById('controlbar'),
  cbTimer: null,
  cbForce: false,
  currentView: 'intro',

  showView(name) {
    /* 先入后出：新视图就位后旧视图退场（铁律 2） */
    const target = this.views[name];
    if (!target || this.currentView === name && !target.hidden) { return; }
    target.hidden = false;
    target.classList.remove('enter');
    void target.offsetWidth;
    target.classList.add('enter');
    const old = this.views[this.currentView];
    if (old && old !== target) {
      setTimeout(() => { old.hidden = true; }, 380);
    }
    this.currentView = name;
    /* 右上角图章：仅朗读画面（player）显示，随朗读画面柔和浮现 */
    const corner = document.querySelector('.mao-portrait');
    if (corner) corner.classList.toggle('show', name === 'player');
    if (name !== 'intro') this.showControlbar();
  },

  /* 开场 → 播放 */
  startIntro() {
    this.views.intro.classList.remove('exit');   /* 清除上次残留的退场态（保险） */
    this.showView('intro');
    const titleEl = document.getElementById('intro-title');
    const subEl = document.getElementById('intro-sub');
    const poem = pickOpeningPoem();
    subEl.textContent = poem ? `${poem.title} · ${poem.year}` : '';

    /* 提前缓冲开场诗音频：进场即播，不在播放页才现拉解码 → 消除进场卡顿 */
    if (poem) {
      PlayerAudio.load(poem);
      setPeriodBackground(poem.period);   // 开场渐显前就把背景切到对应时期图
    }

    /* 磬声与"字炸开爆点"同步（字爆点≈0.6s），不再固定 1500ms */
    setTimeout(() => { Ritual.qing(0.9); }, 600);
    /* 开场收束：转入播放页前先让标题/江山整体渐隐（不硬切）。
       先移除 enter（其 animation fill-mode:both 会把 opacity 锁在 1，挡住渐隐），再触发 exit 动画。
       1850ms 起淡出 0.6s ≈ 2450ms 完成。 */
    setTimeout(() => {
      this.views.intro.classList.remove('enter');
      this.views.intro.classList.add('exit');
    }, 1850);
    /* 播放页在开场淡出中段即开始淡入（2200ms，与 intro 0.6s 淡出 1850→2450 交叉溶解），
       不再等淡出结束才"啪"出现；播放页入场 0.8s 上移淡入，整体柔顺。 */
    setTimeout(() => {
      this.showPlayer({ poemId: poem ? poem.id : (AppState.poems[0] || null), fromIntro: true });
    }, 2200);
  },

  /* 播放页 */
  showPlayer(opts = {}) {
    const { poemId, resume, fromIntro } = opts;
    let poem = poemId ? AppState.poemById(poemId) : null;
    if (!poem) {
      const last = AppState.loadLastPoem();
      if (last) poem = AppState.poemById(last.id);
    }
    if (!poem) poem = AppState.poems[0];
    if (!poem) return;

    /* 先渲染（预置字位槽），再显示视图，再播放 */
    if (!Player.poem || Player.poem.id !== poem.id) {
      Player.render(poem);
    }
    PlayerAudio.load(poem);

    this.showView('player');
    document.querySelectorAll('.panel').forEach(p => { p.hidden = true; });
    this.refreshFavBtn();

    if (resume && !fromIntro) {
      const last = AppState.loadLastPoem();
      if (last && last.id === poem.id && last.t > 0.5) {
        PlayerAudio.seek(last.t);
      }
      if (last && last.playing) { this.play(); }
      else { Player.showAll(); this.refreshPlayBtn(); }
    } else {
      PlayerAudio.seek(0);
      PlayerAudio.play();
      this.refreshPlayBtn();
    }
  },

  /* 目录页 */
  showCatalog() {
    AppState.saveLastPoem(
      Player.poem ? Player.poem.id : null,
      !PlayerAudio.paused,
      PlayerAudio.currentTime
    );
    this.showView('catalog');
    if (!Catalog.currentPeriod) {
      const groups = AppState.periodsWithCount();
      Catalog.currentPeriod = groups[0] ? groups[0].period : null;
    }
    Catalog.renderNav();
    Catalog.switchPeriod(Catalog.currentPeriod, true);
    Catalog.refreshReadState();   /* 返回目录时实时刷新"已读"标记 */
  },

  play() { PlayerAudio.play(); this.refreshPlayBtn(); Player.sync(); },
  pause() { PlayerAudio.pause(); Player.showAll(); this.refreshPlayBtn(); },
  togglePlay() {
    if (!Player.poem) return;
    if (PlayerAudio.paused) {
      /* 恢复播放：回到当前句，后续继续按时间戳浮现 */
      this.play();
    } else {
      this.pause();
    }
  },

  prevPoem() { this.stepPoem(-1); },
  nextPoem() { this.stepPoem(1); },
  stepPoem(dir) {
    if (!AppState.poems.length || Player.switching) return;   /* 切诗进行中不再响应连点 */
    const cur = Player.poem || AppState.poems[0];
    let idx = AppState.poems.findIndex(p => p.id === cur.id);
    idx = (idx + dir + AppState.poems.length) % AppState.poems.length;
    const next = AppState.poems[idx];
    PlayerAudio.fadeTo(0, 0.7);   /* 切诗：BGM 缓出 */
    if (PlayerAudio.bgmEl.src) { try { PlayerAudio.bgmEl.currentTime = 0; } catch (e) {} }  /* 每首诗音乐从头（v1.14.2） */
    Player.switchTo(next);
    PlayerAudio.load(next);
    setTimeout(() => { PlayerAudio.play(); this.refreshPlayBtn(); }, 500);
  },

  /* 上一句 / 下一句 */
  stepLine(dir) {
    if (!Player.poem) return;
    const lines = Player.poem.lines.filter(l => l.sim);
    if (!lines.length) return;
    const t = PlayerAudio.currentTime + ((Player.poem.ts_offset) || 0);
    let idx = 0;
    for (let i = 0; i < lines.length; i++) if (t >= lines[i].t_start) idx = i;
    const target = idx + dir;
    if (target < 0 || target >= lines.length) return;
    PlayerAudio.seek(lines[target].t_start);
    Player.sync();
  },

  refreshPlayBtn() {
    const btn = document.getElementById('cb-play');
    btn.classList.toggle('playing', !PlayerAudio.paused);
  },
  refreshFavBtn() {
    const btn = document.getElementById('cb-fav');
    const on = Player.poem && AppState.isFav(Player.poem.id);
    btn.classList.toggle('on', !!on);
    this.refreshSeal();
  },
  refreshSeal() {
    const seal = document.getElementById('player-seal');
    if (seal) {
      const on = Player.poem && AppState.isFav(Player.poem.id);
      seal.classList.toggle('on', !!on);
    }
  },
  toggleFav() {
    if (!Player.poem) return;
    const on = AppState.toggleFav(Player.poem.id);
    document.getElementById('cb-fav').classList.toggle('on', on);
    this.refreshSeal();
    Ritual.ta();
  },

  /* ---------- 控制条显隐 ---------- */
  showControlbar() {
    this.controlbar.classList.add('show');
    clearTimeout(this.cbTimer);
    if (this.currentView === 'catalog') return;
    this.cbTimer = setTimeout(() => {
      if (!this.cbForce) this.controlbar.classList.remove('show');
    }, 3500);
  },
  toggleControlbar() {
    this.cbForce = !this.cbForce;
    this.controlbar.classList.toggle('show', this.cbForce);
  }
};

/* ---------- 开场选诗：优先"开场推荐诗"（中篇幅宏大名篇，展示更佳），否则随机未读 ---------- */
function pickOpeningPoem() {
  if (!AppState.poems.length) return null;
  const opening = AppState.poems.find(p => p.opening);
  if (opening) return opening;                      /* 数据里 opening:true 的那首（可随时换） */
  const unread = AppState.poems.filter(p => !AppState.read.includes(p.id));
  const pool = unread.length ? unread : AppState.poems;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------- 面板（设置 / 赏析） ---------- */
const Panels = {
  open(name) {
    const el = document.getElementById(name);
    if (!el) return;
    if (name === 'panel-appreciation') this.bindAppreciation();
    if (name === 'panel-pick') { PickPanel.renderNav(); PickPanel.renderList(); }
    el.hidden = false;
  },
  close(name) {
    const el = document.getElementById(name);
    if (el) el.hidden = true;
  },
  closeAll() {
    document.querySelectorAll('.panel').forEach(p => { p.hidden = true; });
  },
  /* 赏析面板：强绑定当前诗 */
  bindAppreciation() {
    const poem = Player.poem;
    const bg = document.getElementById('appr-background');
    const ap = document.getElementById('appr-appreciation');
    const ti = document.getElementById('appr-title');
    if (!poem) {
      bg.textContent = '尚未开始播放。';
      ap.textContent = '进入一首诗，此处将呈现其创作背景与白话赏析。';
      ti.textContent = '背景与赏析';
      return;
    }
    ti.textContent = poem.title;
    bg.textContent = poem.background || '（暂无）';
    ap.textContent = poem.appreciation || '（暂无）';
    const src = document.getElementById('appr-source');
    if (src) src.textContent = '音频来源：' + (poem.source || '公开渠道');
  }
};

/* ---------- 设置面板 ---------- */
const SettingsUI = {
  init() {
    const s = AppState.settings;
    document.body.classList.add('font-' + s.font);
    this.syncFontSeg();
    this.initBgm();
    document.getElementById('set-subtitle').checked = s.subtitle;
    document.getElementById('set-ritual').checked = s.ritual_sound;
    document.getElementById('set-click').checked = s.click_sound;
    document.getElementById('set-bgmon').checked = s.bgm_on;
    /* 文字亮度 */
    const brightEl = document.getElementById('set-bright');
    const brightVal = document.getElementById('set-bright-val');
    brightEl.value = s.bright;
    brightVal.textContent = Math.round(s.bright * 100) + '%';
    this.applyBright(s.bright);

    /* 音乐音量（BGM 大小，默认 75%，拖动即生效） */
    const bv = (s.bgm_volume == null ? 0.5 : s.bgm_volume);
    const bgmVolEl = document.getElementById('set-bgmvol');
    const bgmVolVal = document.getElementById('set-bgmvol-val');
    bgmVolEl.value = Math.round(bv * 100);
    bgmVolVal.textContent = Math.round(bv * 100) + '%';
    document.getElementById('set-bgmvol').addEventListener('input', e => {
      const v = Number(e.target.value) / 100;
      AppState.settings.bgm_volume = v;
      AppState.saveSettings();
      document.getElementById('set-bgmvol-val').textContent = Math.round(v * 100) + '%';
      PlayerAudio.refreshBgmVolume();
    });

    /* 字体切换 */
    document.querySelectorAll('#set-font button').forEach(btn => {
      btn.addEventListener('click', () => {
        AppState.settings.font = btn.dataset.val;
        AppState.saveSettings();
        this.syncFontSeg();
        Player.applyFont();
        Ritual.ta();
      });
    });
    /* 字号切换 */
    document.querySelectorAll('#set-size button').forEach(btn => {
      btn.addEventListener('click', () => {
        AppState.settings.font_size = btn.dataset.val;
        AppState.saveSettings();
        this.syncFontSeg();
        Player.applyFont();
        Ritual.ta();
      });
    });
    /* 氛围浓度：云影/飞鸟/逐句墨晕强度（强/中/弱/关，即时生效+记住） */
    document.querySelectorAll('#set-atmo button').forEach(btn => {
      btn.addEventListener('click', () => {
        AppState.settings.atmosphere = btn.dataset.val;
        AppState.saveSettings();
        this.syncAtmoSeg();
        this.applyAtmosphere();
        Ritual.ta();
      });
    });
    this.syncAtmoSeg();
    this.applyAtmosphere();
    /* 字幕 */
    document.getElementById('set-subtitle').addEventListener('change', e => {
      AppState.settings.subtitle = e.target.checked;
      AppState.saveSettings();
      if (!e.target.checked) {
        document.getElementById('player-subtitle').textContent = '';
      } else {
        Player.setCurrent(Player.currentIdx);
      }
    });
    /* 仪式音 / 点击音 */
    document.getElementById('set-ritual').addEventListener('change', e => {
      AppState.settings.ritual_sound = e.target.checked;
      AppState.saveSettings();
    });
    document.getElementById('set-click').addEventListener('change', e => {
      AppState.settings.click_sound = e.target.checked;
      AppState.saveSettings();
    });
    /* BGM */
    document.getElementById('set-bgm').addEventListener('change', e => {
      AppState.settings.bgm_id = e.target.value ? Number(e.target.value) : null;
      AppState.saveSettings();
      PlayerAudio.applyBgm();
    });
    /* 文字亮度滑杆：拖动即生效 */
    document.getElementById('set-bright').addEventListener('input', e => {
      const v = Number(e.target.value);
      AppState.settings.bright = v;
      AppState.saveSettings();
      document.getElementById('set-bright-val').textContent = Math.round(v * 100) + '%';
      this.applyBright(v);
    });
    document.getElementById('set-bgmon').addEventListener('change', e => {
      AppState.settings.bgm_on = e.target.checked;
      AppState.saveSettings();
      PlayerAudio.applyBgm();
    });
    /* 还原默认 */
    document.getElementById('btn-reset').addEventListener('click', () => {
      AppState.settings = {
        font: 'stele', font_size: 'l', bright: 0.4, atmosphere: 'off',
        bgm_id: null, bgm_on: true, bgm_volume: 0.3,
        subtitle: false, ritual_sound: true, click_sound: true
      };
      AppState.saveSettings();
      document.getElementById('set-subtitle').checked = false;
      document.getElementById('set-ritual').checked = true;
      document.getElementById('set-click').checked = true;
      document.getElementById('set-bgmon').checked = true;
      document.getElementById('set-bright').value = 0.4;
      document.getElementById('set-bright-val').textContent = '40%';
      this.applyBright(0.4);
      document.getElementById('set-bgmvol').value = 30;
      document.getElementById('set-bgmvol-val').textContent = '30%';
      PlayerAudio.refreshBgmVolume();
      this.syncFontSeg();
      this.syncAtmoSeg();
      this.applyAtmosphere();
      this.initBgm();
      Player.applyFont();
      Toast.show('已还原默认设置');
    });
  },

  /* 文字亮度：设 CSS 变量。<=100% 走 opacity；>100% 转成金晕补偿（字更亮不靠透明度） */
  applyBright(v) {
    const root = document.documentElement;
    if (!root || !root.style) return;
    root.style.setProperty('--line-op', Math.min(v, 1));
    const glow = v > 1 ? Math.min((v - 1) * 2, 1) : 0;
    root.style.setProperty('--line-glow', glow);
  },

  syncFontSeg() {
    document.querySelectorAll('#set-font button').forEach(b =>
      b.classList.toggle('active', b.dataset.val === AppState.settings.font));
    document.querySelectorAll('#set-size button').forEach(b =>
      b.classList.toggle('active', b.dataset.val === (AppState.settings.font_size || 'm')));
  },

  syncAtmoSeg() {
    document.querySelectorAll('#set-atmo button').forEach(b =>
      b.classList.toggle('active', b.dataset.val === (AppState.settings.atmosphere || 'm')));
  },

  /* 氛围浓度：写 body[data-atmo]，CSS 据此调节云影/飞鸟/飞白/墨晕强度（即时生效） */
  applyAtmosphere() {
    document.body.dataset.atmo = AppState.settings.atmosphere || 'm';
  },

  initBgm() {
    const sel = document.getElementById('set-bgm');
    if (!AppState.bgms.length) {
      sel.innerHTML = '<option value="">（暂无曲目）</option>';
      sel.disabled = true;
      document.getElementById('set-bgmon').disabled = true;
      return;
    }
    sel.disabled = false;
    document.getElementById('set-bgmon').disabled = false;
    sel.innerHTML = AppState.bgms.map(b =>
      `<option value="${b.id}" ${b.id === AppState.settings.bgm_id ? 'selected' : ''}>${b.title}</option>`).join('');
  }
};

/* ---------- 键盘 ---------- */
document.addEventListener('keydown', e => {
  const anyPanelOpen = Array.from(document.querySelectorAll('.panel')).some(p => !p.hidden);
  if (e.code === 'Escape') {
    if (anyPanelOpen) { Panels.closeAll(); return; }
    if (UI.currentView !== 'intro') UI.toggleControlbar();
    return;
  }
  if (UI.currentView !== 'player') return;
  if (e.code === 'Space') { e.preventDefault(); UI.togglePlay(); }
  else if (e.code === 'ArrowLeft') UI.stepLine(-1);
  else if (e.code === 'ArrowRight') UI.stepLine(1);
});

/* ---------- 控制条事件 ---------- */
document.addEventListener('pointermove', () => { UI.showControlbar(); });
/* 手机端：无鼠标，点按/滑动屏幕即唤出控制条（PC 触控板无碍） */
document.addEventListener('touchstart', () => { UI.showControlbar(); }, { passive: true });
document.getElementById('cb-play').addEventListener('click', () => { Ritual.ta(); UI.togglePlay(); });
document.getElementById('cb-prev').addEventListener('click', () => { Ritual.ta(); UI.prevPoem(); });
document.getElementById('cb-next').addEventListener('click', () => { Ritual.ta(); UI.nextPoem(); });
document.getElementById('cb-fav').addEventListener('click', () => UI.toggleFav());
document.getElementById('cb-settings').addEventListener('click', () => { Ritual.ta(); Panels.open('panel-settings'); });
document.getElementById('cb-appreciation').addEventListener('click', () => { Ritual.ta(); Panels.open('panel-appreciation'); });
document.getElementById('cb-pick').addEventListener('click', () => { Ritual.ta(); Panels.open('panel-pick'); });
document.querySelectorAll('.panel-close').forEach(b =>
  b.addEventListener('click', () => Panels.close(b.dataset.close)));
document.querySelectorAll('.panel').forEach(p =>
  p.addEventListener('click', e => { if (e.target === p) p.hidden = true; }));

/* ---------- 选诗面板：按时期分区 ---------- */
const PickPanel = {
  period: null,
  init() {
    const groups = AppState.periodsWithCount();
    if (groups.length) this.period = groups[0].period;
    this.renderNav();
    this.renderList();
  },
  renderNav() {
    const nav = document.getElementById('pick-nav');
    if (!nav) return;
    const groups = AppState.periodsWithCount();
    nav.innerHTML = groups.map(g =>
      `<button class="pick-tab${g.period === this.period ? ' active' : ''}" data-p="${g.period}">${g.period}</button>`
    ).join('');
    nav.querySelectorAll('.pick-tab').forEach(b => {
      b.addEventListener('click', () => {
        this.period = b.dataset.p;
        this.renderNav();
        this.renderList();
      });
    });
  },
  renderList() {
    const list = document.getElementById('pick-list');
    if (!list) return;
    const items = AppState.poems.filter(p => p.period === this.period);
    list.innerHTML = items.map(p => {
      const cur = Player.poem && Player.poem.id === p.id ? ' current' : '';
      const fav = AppState.isFav(p.id) ? ' fav' : '';
      return `<button class="pick-item${cur}${fav}" data-id="${p.id}">
        <span class="pi-title">${p.title}</span>
        <span class="pi-year">${p.year}</span>
      </button>`;
    }).join('');
    list.querySelectorAll('.pick-item').forEach(b => {
      b.addEventListener('click', () => {
        const poem = AppState.poemById(Number(b.dataset.id));
        if (!poem) return;
        Panels.closeAll();
        UI.showPlayer({ poemId: poem.id, fromIntro: false });
      });
    });
  }
};

/* ---------- 播放同步循环（rAF 高频率，替代 timeupdate 的 250ms 延迟） ---------- */
let _syncRAF = null;
function syncLoop() {
  /* v1.13 视图门控：仅播放视图且朗读在播才同步（目录/开场跳过，省 CPU 与隐藏视图 DOM 操作） */
  if (!PlayerAudio.paused && UI.currentView === 'player') {
    Player.sync();
  }
  _syncRAF = requestAnimationFrame(syncLoop);
}
_syncRAF = requestAnimationFrame(syncLoop);
/* timeupdate 作为兜底（切句边界保底） */
PlayerAudio.el.addEventListener('timeupdate', () => { Player.sync(); });
PlayerAudio.el.addEventListener('pause', () => { Player.showAll(); });

/* ---------- 切诗金粉粒子 ---------- */
function spawnSparks(x, y, n = 14) {
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.style.setProperty('--dx', (Math.random() * 80 - 40) + 'px');
    s.style.setProperty('--dy', (Math.random() * 80 - 40) + 'px');
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1200);
  }
}

/* ---------- 切诗点睛：中心暗金粒子"绽开即收拢"（不四散，收束淡出） ---------- */
function spawnInkBurst(x, y, n = 10) {
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div');
    s.className = 'ink-burst';
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const dist = 40 + Math.random() * 60;
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
    s.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 950);
  }
}

/* ---------- 浮尘粒子（疏密两层：远层细淡、近层稍亮更大；数量按屏宽自适应） ---------- */
function initDust() {
  const layer = document.getElementById('dust-layer');
  if (!layer) return;
  const mob = window.innerWidth < 640;
  const total = mob ? Math.min(12, Math.floor(window.innerWidth / 34))
                    : Math.min(26, Math.floor(window.innerWidth / 80));
  let html = '';
  for (let i = 0; i < total; i++) {
    const near = i % 3 === 0;                       // 约 1/3 为近层（更亮更大）
    const x = Math.random() * 100;
    const y = 18 + Math.random() * 78;
    const dur = (near ? 10 : 18) + Math.random() * (near ? 16 : 28);
    const delay = Math.random() * 32;
    const size = near ? 3 : 1.5;
    const op = near ? 0.7 : 0.32;
    html += `<span class="dust" style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;opacity:${op};animation-duration:${dur.toFixed(0)}s;animation-delay:${delay.toFixed(0)}s"></span>`;
  }
  layer.innerHTML = html;
}

/* ---------- 江山层叠（已移除：背景采用纯用户图） ---------- */

/* ---------- 流动云海（多层错速漂移，远近不同速度/模糊/透明度，制造纵深） ---------- */
function initClouds() {
  const layer = document.getElementById('bg-clouds');
  if (!layer) return;
  const layers = [
    { n: 2, blur: 20, opMin: 0.10, opMax: 0.18, hMin: 42, hMax: 66, durMin: 120, durMax: 200, topMin: 16, topMax: 36 }, // 远
    { n: 2, blur: 14, opMin: 0.26, opMax: 0.46, hMin: 58, hMax: 90, durMin: 78, durMax: 140, topMin: 34, topMax: 58 }, // 中
    { n: 2, blur: 8,  opMin: 0.42, opMax: 0.64, hMin: 80, hMax: 120, durMin: 46, durMax: 90, topMin: 56, topMax: 82 } // 近
  ];
  let html = '';
  layers.forEach(L => {
    for (let i = 0; i < L.n; i++) {
      const top = L.topMin + Math.random() * (L.topMax - L.topMin);
      const width = 26 + Math.random() * 54;
      const dur = L.durMin + Math.random() * (L.durMax - L.durMin);
      const delay = -(Math.random() * dur);
      const op = L.opMin + Math.random() * (L.opMax - L.opMin);
      const h = L.hMin + Math.random() * (L.hMax - L.hMin);
      html += `<div class="cloud" style="top:${top.toFixed(1)}vh;height:${h.toFixed(0)}px;width:${width.toFixed(1)}vw;opacity:${op.toFixed(2)};filter:blur(${L.blur}px);animation-duration:${dur.toFixed(0)}s;animation-delay:${delay.toFixed(0)}s"></div>`;
    }
  });
  layer.innerHTML = html;
}

/* ---------- 大块云影掠过（2 层，每分钟级极缓，错速纵深，纯装饰不抢焦；v1.13 减层） ---------- */
function initShadows() {
  const stage = document.querySelector('.bg-stage');
  if (!stage || stage.querySelector('.bg-shadow')) return;
  const layer = document.createElement('div');
  layer.className = 'bg-shadow';
  const n = 2;                                          // 固定 2 层（降合成压力）
  const specs = [
    { w: 32, dur: 300, top: -6 },
    { w: 46, dur: 215, top: 18 }
  ];
  for (let i = 0; i < n; i++) {
    const s = specs[i % specs.length];
    const dur = s.dur + Math.random() * 40;
    const sh = document.createElement('div');
    sh.className = 'sh';
    sh.style.width = (s.w + Math.random() * 12) + 'vw';
    sh.style.top = s.top + '%';
    sh.style.animationDuration = dur.toFixed(0) + 's';
    sh.style.animationDelay = (-(Math.random() * dur)).toFixed(0) + 's';
    layer.appendChild(sh);
  }
  stage.appendChild(layer);
}

/* ---------- 飞鸟雁阵（剪影式苍茫寂寥，极缓掠过，几分钟一次） ---------- */
function initBirds() {
  const stage = document.querySelector('.bg-stage');
  if (!stage || stage.querySelector('.bg-birds')) return;
  const layer = document.createElement('div');
  layer.className = 'bg-birds';
  const flock = document.createElement('div');
  flock.className = 'flock';
  const m = 3 + Math.floor(Math.random() * 3);          // 3-5 只
  for (let i = 0; i < m; i++) {
    const b = document.createElement('div');
    b.className = 'bird';
    flock.appendChild(b);
  }
  const dur = 200 + Math.random() * 100;                // 3-5 分钟一巡
  flock.style.animationDuration = dur.toFixed(0) + 's';
  flock.style.top = (18 + Math.random() * 26) + 'vh';
  layer.appendChild(flock);
  stage.appendChild(layer);
}

/* ---------- 版本角标 ---------- */
document.getElementById('version-badge').textContent = 'v' + VERSION;

/* ---------- Service Worker：防缓存旧版 + 修复音频 ---------- */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  /* 清掉旧版本 SW 缓存（含可能损坏的音频缓存），避免旧 SW 缓存架空本次修复 */
  if ('caches' in window) {
    caches.keys().then(keys => keys.forEach(k => {
      if (k.indexOf('maoshi-wb-') === 0 && k !== 'maoshi-wb-' + VERSION) caches.delete(k).catch(() => {});
    })).catch(() => {});
  }
  /* SW 装好新版本后通过 postMessage 通知本页；若本页仍是旧 JS（version 不同）则自动刷新，
     加载最新脚本——解决「改了却看不到」反复发生的根因（clients.claim 只换 SW 不重跑旧脚本） */
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'sw-updated' && e.data.version !== VERSION) {
      location.reload(true);
    }
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js?v=' + VERSION)
      .then(reg => reg.update().catch(() => {}))
      .catch(() => {});
  });
}

/* ---------- 全局错误兜底：不白屏（铁律 6） ---------- */
window.addEventListener('error', e => {
  console.error(e.message);
  try { Toast.show('页面遇到异常，已自动恢复'); } catch (err) {}
});
window.addEventListener('unhandledrejection', e => {
  console.error(e.reason);
});

/* ---------- 自动播放兜底：浏览器拦截带声朗读/BGM 时，首次用户手势即解锁并补播 ---------- */
function armAutoplayFallback() {
  const onGesture = (e) => {
    /* 点到控制条/按钮等交互元素时交给它们自己处理，避免「先播后停」冲突 */
    if (e && e.target && e.target.closest &&
        e.target.closest('.controlbar, .panel, button, a, input, .pick-tab')) return;
    /* 手势即解锁音频上下文（朗诵 WebAudio + 仪式音 + BGM） */
    PlayerAudio.unlockAudio();
    /* 播放页 + 正好暂停 + 有诗 + 非用户主动暂停 → 立即补播 */
    if (UI.currentView === 'player' && PlayerAudio.paused && Player.poem && !PlayerAudio._manualPause) {
      PlayerAudio.play();
      UI.refreshPlayBtn();
      Player.sync();
    }
  };
  window.addEventListener('pointerdown', onGesture);
  window.addEventListener('keydown', onGesture);
}

/* ---------- 启动 ---------- */
(async function boot() {
  AppState.load();
  /* 低端机 / 弱硬件判定：隐藏最吃合成的新背景层，保流畅（CSS .low-end 联动） */
  const cores = navigator.hardwareConcurrency || 4;
  if (cores <= 4 || window.innerWidth < 640) document.body.classList.add('low-end');
  await loadPoems();
  armAutoplayFallback();
  SettingsUI.init();
  /* 不在此处启动 BGM：音乐等诗词正文出现（首次 play）才开始，开场黑场保持安静（v1.12.1） */
  Catalog.init();
  PickPanel.init();
  initClouds();
  initDust();
  initShadows();
  initBirds();

  /* url ?poem=xxx 调试入口：跳过开场直接进播放页（截图用） */
  const urlPoemRaw = new URLSearchParams(location.search).get('poem');
  const urlPanel = new URLSearchParams(location.search).get('panel');
  if (urlPoemRaw) {
    const pid = parseInt(urlPoemRaw, 10) || urlPoemRaw;
    const p = AppState.poemById(pid);
    if (p) {
      UI.showPlayer({ poemId: p.id });
      PlayerAudio.pause();
      Player.showAll();
      UI.refreshPlayBtn();
      if (urlPanel) setTimeout(() => Panels.open('panel-' + urlPanel), 400);
      return;
    }
  }
  /* 直接开场：浏览器允许时自动朗诵+轮播；被拦截时由 armAutoplayFallback 手势兜底 */
  UI.startIntro();

  /* 晚期版本校验：若已加载脚本版本与页面期望版本不符（资源被错配，极少见），强制刷新兜底 */
  try {
    if (window.__EXPECT_VER && VERSION !== window.__EXPECT_VER) location.reload(true);
  } catch (e) {}
})();
