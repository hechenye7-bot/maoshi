/* ============================================================
   player.js · 播放页：渐显留存 + 朗诵同步 + 字幕
   ============================================================ */
'use strict';

/* 手机端判定（≤640px；PC 端走原布局参数，互不影响） */
const isMobile = () => window.innerWidth < 640;

const Player = {
  poem: null,
  bodyEl: document.getElementById('player-body'),
  titleEl: document.getElementById('player-title'),
  bylineEl: document.getElementById('player-byline'),
  subEl: document.getElementById('player-subtitle'),
  wrapEl: null,
  lineEls: [],
  revealedIdx: -1,     // 已浮现到第几句
  currentIdx: -1,      // 当前高亮句
  offsets: [],         // 每句高低错落偏移
  switching: false,

  /* ---------- 渲染整首诗（半句一列，按格律分行） ---------- */
  render(poem) {
    this.poem = poem;
    const lines = poem.lines.filter(l => l.sim);

    /* 自适应分行：保留数据格律断句，每行列数封顶，保证适中字号；短诗单行、长诗多行 */
    const dataStanzas = (poem.stanzas && poem.stanzas.length) ? poem.stanzas : [lines.length];
    const stanzas = this.computeRows(lines, dataStanzas);
    poem._stanzas = stanzas;
    let gi = 0;
    const lastIdx = lines.length - 1;          // 末句作为压轴句（hero，压轴不放大字号）
    const html = stanzas.map(n => {
      const groupLines = lines.slice(gi, gi + n);
      gi += n;
      const groupHtml = groupLines.map((l, j) => {
        const i = gi - n + j;
        const clean = l.sim.replace(/[，。；？！、]/g, '');
        const hero = (i === lastIdx) ? ' hero' : '';
        return `<div class="line-block${hero}" data-i="${i}" style="--off:0vh"><span class="line-text">${clean}</span></div>`;
      }).join('');
      return `<div class="stanza-row">${groupHtml}</div>`;
    }).join('');

    this.bodyEl.innerHTML = `<div class="scroll-wrap">${html}</div>`;
    this.wrapEl = this.bodyEl.querySelector('.scroll-wrap');
    /* 列间距：短诗（单行）空灵 / 长诗常规；手机端收紧（PC 原值 22/14 不变） */
    this.wrapEl.style.setProperty('--col-gap',
      isMobile() ? (stanzas.length === 1 ? '14px' : '8px')
                 : (stanzas.length === 1 ? '22px' : '14px'));
    this.lineEls = Array.from(this.wrapEl.querySelectorAll('.line-block'));
    this.applySliceOffsets();

    /* 字号：按最长半句字数适配（竹简列高不超视口） */
    this.applyFontSize(lines, stanzas);

    /* 揭示初始化：
       毛体 → pending（未读隐形，预置字位槽不跳，播放时逐句墨晕浮现）
       碑刻 → 保持原风格：全篇直接 revealed（半透），仅 current 亮 */
    this.currentIdx = -1;
    if (AppState.settings.font !== 'mao') {
      this.lineEls.forEach(el => el.classList.add('revealed'));
      this.revealedIdx = lines.length - 1;
    } else {
      this.revealedIdx = -1;
    }

    this.titleEl.textContent = poem.title;
    this.bylineEl.textContent = '—— ' + poem.year;
    this.subEl.textContent = '';
    UI.refreshSeal();
    /* ④ 时期色调跟随当前诗（body[data-period] 驱动电影分级背景色） */
    document.body.setAttribute('data-period', poem.period || '');
  },

  /* 字号：整首统一字号，约束在适中区间（默认 42–52px），零溢出 */
  applyFontSize(lines, stanzas) {
    const rows = stanzas && stanzas.length ? stanzas : [lines.length];
    const n = rows.length;
    const maxcols = Math.max(...rows);
    const mob = isMobile();
    const LH = 1.20;
    const PAD = mob ? 18 : 32;              /* 手机列内 padding 9px×2；PC 16px×2 */
    const GAP = mob ? 18 : 24;              /* 手机行距 9px×2；PC 12px×2（与CSS严格对齐） */
    const COLW = mob ? 12 : 16;             /* 手机列距 8px → 12；PC 14px → 16 */
    /* fontBoost：开场展示诗等可放宽垂直空间让字稍大（上限 1.2，fit 仍保零溢出） */
    const boost = (this.poem && this.poem.fontBoost) || 1;
    const AVAIL_H = Math.min(window.innerHeight - (mob ? 110 : 192),
                             (mob ? 620 : 740) * Math.min(boost, 1.2));
    const AVAIL_W = Math.max(280, window.innerWidth - (mob ? 24 : 160));
    const MINPX = mob ? 16 : 18;            /* 手机下限 16（高DPI可读），PC 18 */
    const lineEls = this.wrapEl ? this.wrapEl.querySelectorAll('.line-text') : [];

    const lens = lines.map(l => (l.sim || '').replace(/[，。；？！、]/g, '').length || 1);
    const longest = Math.max(...lens, 1);

    /* 适中基准：按最长半句映射（v1.9 起封顶 52px 控字高） */
    const map = { 3:56,4:56,5:54,6:52,7:50,8:48,9:46,10:44,11:43,12:42,13:42,14:42,15:40 };
    const base = map[longest] || 38;

    /* 「字号」设置生效：适中=m 用基准；大=l 略放大（仍封顶 52）；fontBoost 诗再上浮 */
    const mode = (AppState.settings.font_size || 'm');
    const mul = mode === 'l' ? 1.06 : 1.0;

    const rawTotalAt = (px) => n * (longest * px * LH + PAD) + (n - 1) * GAP;
    const rawWidthAt = (px) => maxcols * (px + COLW);

    let px = Math.min(mob ? 42 : 52, base * mul * boost);   /* fontBoost 诗起始更高 */
    const fits = (p) => rawTotalAt(p) <= AVAIL_H && (mob || rawWidthAt(p) <= AVAIL_W);
    while (px > MINPX && !fits(px)) px -= 0.5;      /* 手机宽度超限走横向轻滑，不压字 */
    px = Math.max(MINPX, Math.round(px));

    lineEls.forEach(el => { el.style.fontSize = px + 'px'; });
  },

  /* 错落有致（v1.12.4 更不规矩）：主波 + 副波多频叠加打破机械波浪，加大抖动，
     像手书一气呵成的自然起伏；仍按诗标题种子确定性生成，每首错落各异 */
  applySliceOffsets() {
    const slices = Array.from(this.wrapEl.querySelectorAll('.line-block'));
    const N = slices.length;
    if (!N) return;
    const title = (this.poem && this.poem.title) || '';
    let h = 0;
    for (let k = 0; k < title.length; k++) h = (h * 31 + title.charCodeAt(k)) % 100000;
    const seed = (h % 1000) / 1000;                 // 0..1 → 每首诗参数固定且不同
    const k = isMobile() ? 0.6 : 1;                 // 手机端错落收缩（窄屏防出屏/重叠），PC 原样
    const amp1 = (22 + seed * 26) * k;              // 主波振幅 22..48 px
    const amp2 = amp1 * (0.4 + seed * 0.15);        // 副波（非整数倍频，打破规律）
    const freq = 0.55 + seed * 0.4;                 // 主波频率
    const phase = seed * Math.PI * 2;
    const jitterAmp = (10 + seed * 14) * k;         // 抖动 10..24 px（更随性）
    let s = h + 7;
    const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const LIMIT = isMobile() ? 26 : 54;             // 限幅：手机 ±26，PC ±54
    slices.forEach((el, i) => {
      const w1 = Math.sin(i * freq + phase) * amp1;
      const w2 = Math.sin(i * 2.3 * freq + phase * 2.7) * amp2;   // 多频 → 起伏不再规整重复
      const jit = (rand() - 0.5) * 2 * jitterAmp;
      let off = Math.round(w1 + w2 + jit);
      off = Math.max(-LIMIT, Math.min(LIMIT, off));       // 限幅，避免重叠过甚
      el.style.setProperty('--off', off + 'px');
      el.style.setProperty('--float-delay', (rand() * 5).toFixed(1) + 's');
      el.style.setProperty('--float-dur', (3 + rand() * 3).toFixed(1) + 's');
    });
  },

  /* 自适应分行：保留数据格律断句（阕/联）为硬分组，组内每行最多 MAXCOL 列，超出换行。
     既保住上阕/下阕的视觉间隔，又让每行不至于过长把字号压小。 */
  computeRows(lines, dataStanzas) {
    const MAXCOL = 12;   // 每行最多 12 列（行数最少化；手机超宽走横向轻滑，不缩列增行）
    const bounds = [];
    let acc = 0;
    dataStanzas.forEach(c => { acc += c; bounds.push(acc); });
    const rows = [];
    let cur = 0;
    for (let i = 0; i < lines.length; i++) {
      const atBoundary = bounds.indexOf(i) !== -1 && i > 0;  // 进入新阕/联
      /* 阕边界处若当前行不足 3 列则不强行断（避免孤列）；满 12 列必断 */
      if (cur > 0 && (cur >= MAXCOL || (atBoundary && cur >= 3))) { rows.push(cur); cur = 0; }
      cur++;
    }
    if (cur > 0) rows.push(cur);
    return rows.length ? rows : [lines.length];
  },

  /* ---------- 渐显留存：逐句墨晕浮现 + 当前高亮（rAF + timeupdate 双驱动） ---------- */
  sync() {
    if (!this.poem || !this.wrapEl) return;
    const t = PlayerAudio.currentTime;
    const lines = this.poem.lines.filter(l => l.sim);
    const paused = PlayerAudio.paused;

    if (paused) {
      this.wrapEl.classList.add('paused');
      this.revealAll();                 /* 暂停：显全篇 */
      this.setCurrent(-1);
      return;
    }
    this.wrapEl.classList.remove('paused');

    /* 正文极短延迟（落眼用） */
    if (t < 0.1) { this.setCurrent(-1); return; }

    /* 每诗可选整体偏移（ts_offset，秒），对齐后一般无需设置 */
    const tp = t + ((this.poem && this.poem.ts_offset) || 0);

    /* 同步（v1.14.2 折中）：LEAD 光先于声 0.18s；TAIL 句尾提前 0.15s 切换 */
    const LEAD = 0.18;
    const TAIL = 0.15;

    /* 毛体：逐句墨晕浮现 —— 到点即 reveal，已现留存、未读隐形（碑刻保持全显原风格） */
    if (AppState.settings.font === 'mao') {
      for (let i = 0; i < lines.length; i++) {
        if (tp >= lines[i].t_start - LEAD) this.revealLine(i);
      }
    }

    /* 当前句：t 落在 [t_start - LEAD, t_end - TAIL) */
    let cur = -1;
    for (let i = 0; i < lines.length; i++) {
      if (tp >= lines[i].t_start - LEAD && tp < lines[i].t_end - TAIL) { cur = i; break; }
    }
    this.setCurrent(cur);
  },

  /* 揭示单句（幂等，毛体渐进浮现用） */
  revealLine(i) {
    const el = this.lineEls[i];
    if (el && !el.classList.contains('revealed')) {
      el.classList.add('revealed');
      this.revealedIdx = Math.max(this.revealedIdx, i);
    }
  },
  /* 全篇揭示（暂停 / 切碑刻 / 切诗时用） */
  revealAll() {
    if (!this.lineEls.length) return;
    this.lineEls.forEach(el => el.classList.add('revealed'));
    this.revealedIdx = this.lineEls.length - 1;
  },

  setCurrent(i) {
    if (i === this.currentIdx) return;
    if (this.currentIdx >= 0 && this.lineEls[this.currentIdx]) {
      this.lineEls[this.currentIdx].classList.remove('current');
    }
    this.currentIdx = i;
    if (i >= 0 && this.lineEls[i]) {
      this.lineEls[i].classList.add('current');
      if (AppState.settings.subtitle) {
        this.subEl.textContent = this.currentText();
      }
    } else if (!AppState.settings.subtitle) {
      this.subEl.textContent = '';
    }
  },

  currentText() {
    const lines = this.poem.lines.filter(l => l.sim);
    if (this.currentIdx < 0 || !lines[this.currentIdx]) return '';
    return lines[this.currentIdx].sim;
  },

  /* 暂停全篇渐显 */
  showAll() {
    if (!this.wrapEl) return;
    this.wrapEl.classList.add('paused');
    this.revealAll();
  },

  /* ---------- 切诗：收墨/落墨 · 庄重仪式感（≤1s） ---------- */
  switchTo(poem) {
    if (this.switching || (this.poem && this.poem.id === poem.id)) return;
    this.switching = true;
    const rect = this.bodyEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    /* 中心绽开极淡暗金粒子（不四散，收拢即灭）点睛 */
    spawnInkBurst(cx, cy, 10);
    const oldEl = this.wrapEl;
    if (oldEl) {
      /* 旧诗"收卷"：轻微收拢 + 淡出 */
      oldEl.style.transition = 'opacity 0.42s ease, transform 0.42s ease';
      oldEl.style.transform = 'scale(0.97)';
      oldEl.style.opacity = '0';
    }
    setTimeout(() => {
      this.render(poem);
      const w = this.wrapEl;
      /* 新诗"落墨"展开：从略放大 + 墨晕淡入到清晰 */
      w.style.opacity = '0';
      w.style.transform = 'scale(1.035)';
      w.style.transition = 'opacity 0.5s ease, transform 0.6s var(--ease)';
      requestAnimationFrame(() => {
        w.style.opacity = '1';
        w.style.transform = 'scale(1)';
      });
      this.switching = false;
    }, 420);
  },

  /* 字体模式即时切换（重渲染当前诗） */
  applyFont() {
    /* 必须清掉全部 font-* 再挂新的：漏清 font-stele 会导致碑刻→毛体切换失效 */
    document.body.classList.remove('font-mao', 'font-stele', 'font-hk');
    document.body.classList.add('font-' + AppState.settings.font);
    if (this.poem) {
      const wasPaused = PlayerAudio.paused;
      this.render(this.poem);
      if (wasPaused) this.showAll();
      this.sync();
    }
  }
};

/* 全局时间同步循环（timeupdate 事件驱动） */
PlayerAudio.init();
PlayerAudio.errorHook = () => {
  Toast.show('音频加载失败，换源或稍后重试');
  UI.refreshPlayBtn();
};
PlayerAudio.endedHook = () => {
  Player.showAll();
  UI.refreshPlayBtn();
  /* 诗播完：BGM 从容缓出到无声后暂停（v1.13.1 2s，不突兀） */
  PlayerAudio.fadeTo(0, 2.0, () => { try { PlayerAudio.bgmEl.pause(); } catch (e) {} });
};

/* 窗口缩放：防抖重算字号与布局（不重渲染，避免窄屏长诗溢出/顶满）。
   手机↔PC 跨 640px 阈值时全量重算（MAXCOL/列距/错落/字号都随 isMobile 变） */
let _resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    if (!Player.poem) return;
    const mob = window.innerWidth < 640;
    if (Player._mobile !== mob) {
      Player._mobile = mob;
      Player.render(Player.poem);            /* 跨形态：全量重建（同步循环会恢复当前句） */
      return;
    }
    const lines = Player.poem.lines.filter(l => l.sim);
    Player.applyFontSize(lines, Player.poem._stanzas || [lines.length]);
  }, 200);
});
