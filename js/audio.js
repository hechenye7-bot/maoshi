/* ============================================================
   audio.js · 音频系统：朗诵 / BGM(Ducking) / 仪式音(WebAudio合成)
   ============================================================ */
'use strict';

const PlayerAudio = {
  el: null,            // Audio 元素（朗诵）
  bgmEl: null,         // Audio 元素（BGM）
  currentPoemId: null,
  endedHook: null,
  errorHook: null,

  init() {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.addEventListener('error', () => {
      if (this.errorHook) this.errorHook();
    });
    this.el.addEventListener('ended', () => {
      this._manualPause = false;   /* 自然播完（非主动暂停），允许后续手势补播 */
      if (this.currentPoemId) AppState.markRead(this.currentPoemId);
      if (this.endedHook) this.endedHook();
    });
    this.bgmEl = new Audio();
    this.bgmEl.loop = false;      /* 一首诗内音乐不循环重复（v1.14.2）；播完由 play() 重头 */
    this.bgmEl.volume = 0;
    this.bgmEl.preload = 'none';
    this._setupVoiceGraph();   /* 朗读 WebAudio 增益链（失败自动退回直出） */
  },
  /* 朗读 WebAudio 增益链：源电平偏低(均值约 -23dB)，用增益放大 + 限幅防破音；
     任何不支持/异常都退回元素直出(volume 1.0)，绝不影响可用性。 */
  _setupVoiceGraph() {
    if (this._voiceTried) return;
    this._voiceTried = true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const src = ctx.createMediaElementSource(this.el);
      const pre = ctx.createGain(); pre.gain.value = 4.5;        // 整体放大 ~+13dB（源电平均值约 -23dB，明显拉响）
      const lim = ctx.createDynamicsCompressor();               // 限幅：峰值不破音
      lim.threshold.value = -1; lim.knee.value = 0;
      lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.1;
      src.connect(pre); pre.connect(lim); lim.connect(ctx.destination);
      this.voiceCtx = ctx;
      this._voiceReady = true;
    } catch (e) {
      this._voiceReady = false;   /* 退回直出 */
    }
  },

  /* ---------- 朗诵 ---------- */
  load(poem) {
    if (!poem) return;
    this.currentPoemId = poem.id;
    const url = poem.audio_url + '?v=' + VERSION;
    if (this.el.src !== new URL(url, location.href).href) {
      this.el.src = url;
    }
    try { this.el.currentTime = 0; } catch (e) {}
  },
  play() {
    /* 朗读 WebAudio 上下文在用户手势内恢复（否则不响） */
    if (this.voiceCtx && this.voiceCtx.state === 'suspended') { try { this.voiceCtx.resume(); } catch (e) {} }
    /* 音乐等诗词出现（首次播放）再开始：开场黑场阶段保持安静 */
    if (!this.bgmEl.src) this.applyBgm();
    /* 音乐已播完（不循环）→ 回到开头，新一轮从头播（v1.14.2） */
    if (this.bgmEl.src && this.bgmEl.ended) {
      try { this.bgmEl.currentTime = 0; } catch (e) {}
    }
    const p = this.el.play();
    if (p && p.then) {
      p.then(() => {
        /* 播放成功（含首次手势补播）→ 清除拦截/手动暂停标记 */
        this._autoplayBlocked = false;
        this._manualPause = false;
        this.syncBgm();          /* 手势放行后：朗读播放中 → 音乐跟上 */
      }).catch(() => {
        /* 浏览器自动播放策略拦截（无用户手势）→ 标记，等首次手势补播 */
        this._autoplayBlocked = true;
        try { Toast.show('点击页面任意处开始播放'); } catch (e) {}
      });
    }
    this.syncBgm();              /* 朗读播放中 → 音乐播放 + 淡入到朗读音量 */
  },
  pause() {
    this.el.pause();
    this._manualPause = true;   /* 用户主动暂停，首次手势兜底不再自动续播 */
    this.syncBgm();             /* 朗读暂停 → 音乐淡出后暂停 */
  },
  seek(t) {
    try { this.el.currentTime = t; } catch (e) {}
  },
  get currentTime() { return this.el.currentTime; },
  get paused() { return this.el.paused; },
  get duration() { return this.el.duration || 0; },

  /* ---------- BGM 统一状态机 ---------- */
  /* 唯一权威函数：朗读状态 → BGM 行为。所有入口（播放/暂停/切诗/手势/选曲）都走这里，
     杜绝"暂停后音乐自己响 / 恢复后音乐消失"等分叉状态。 */
  syncBgm() {
    if (!this.bgmEl || !this.bgmEl.src) return;
    if (this.el.paused) {
      /* 朗读暂停/未播 → 音乐缓出后暂停（若已在暂停则不动） */
      if (!this.bgmEl.paused) {
        this.fadeTo(0, 0.8, () => {
          if (this.el.paused && !this.bgmEl.paused) { try { this.bgmEl.pause(); } catch (e) {} }
        });
      }
    } else {
      /* 朗读播放中 → 音乐续播并缓入到朗读音量（v1.13.1 起停更柔，不违和） */
      if (this.bgmEl.paused) this.bgmEl.play().catch(() => {});
      this.fadeTo(this.bgmTarget(true), 1.2);
    }
  },
  /* BGM 目标音量：base=设置音量(默认0.3)；朗诵中再压 35%（不抢朗读） */
  bgmTarget(reciting) {
    const v = (AppState.settings.bgm_volume == null) ? 0.3 : AppState.settings.bgm_volume;
    return v * (reciting ? 0.55 : 0.9);
  },
  /* 平滑渐变（淡入/淡出共用）：ease-in-out 曲线，起停都柔和不突兀；
     令牌机制：新一次 fade 取消旧 fade（旧回调不再执行），杜绝快速操作的竞态。 */
  fadeTo(target, dur = 1.0, onDone) {
    this._bgmFadeToken = (this._bgmFadeToken || 0) + 1;
    const token = this._bgmFadeToken;
    if (!this.bgmEl.src) { this.bgmEl.volume = target; if (onDone) onDone(); return; }
    const from = this.bgmEl.volume;
    if (Math.abs(from - target) < 0.004) { this.bgmEl.volume = target; if (onDone) onDone(); return; }
    const t0 = performance.now();
    const step = (now) => {
      if (token !== this._bgmFadeToken) return;          /* 已被新过渡取代 → 放弃（含 onDone） */
      const k = Math.min(1, (now - t0) / (dur * 1000));
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   /* ease-in-out */
      this.bgmEl.volume = from + (target - from) * e;
      if (k < 1) requestAnimationFrame(step);
      else if (onDone) onDone();
    };
    requestAnimationFrame(step);
  },
  /* 音量滑杆即时生效（BGM 已暂停时不动） */
  refreshBgmVolume() {
    if (!this.bgmEl.src || this.bgmEl.paused) return;
    this.fadeTo(this.bgmTarget(!this.el.paused), 0.25);
  },
  /* 首次用户手势兜底：按朗读状态走统一状态机（朗读暂停时绝不擅自拉起音乐） */
  resumeBgm() {
    this.syncBgm();
  },
  /* 加载/切换 BGM 曲目（不直接开播，是否响由 syncBgm 按朗读状态决定） */
  applyBgm() {
    const s = AppState.settings;
    const bgm = AppState.bgms.find(b => b.id === s.bgm_id) || AppState.bgms[0] || null;
    if (!bgm || !s.bgm_on) { this.bgmEl.pause(); this.bgmEl.src = ''; return; }
    const url = bgm.url + '?v=' + VERSION;
    if (this.bgmEl.src !== new URL(url, location.href).href) {
      this.bgmEl.src = url;
      this.bgmEl.volume = 0;
      this.syncBgm();            /* 朗读在播则立即淡入，暂停则等播放 */
    }
  }
};

/* ---------- 仪式音：WebAudio 合成（磬/铜磬/嗒） ---------- */
const Ritual = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  /* 磬：一声更沉（开场，中低音主体 + 低八度铺底，带重量感） */
  qing(dur = 0.9) {
    if (!AppState.settings.ritual_sound) return;
    const ctx = this.ensure(); if (!ctx) return;
    const t0 = ctx.currentTime;
    /* 主体：中低音，缓慢下滑 —— 比旧版(720→360)低一个八度，更"沉" */
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(432, t0);
    osc.frequency.exponentialRampToValueAtTime(216, t0 + dur * 0.6);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
    /* 低八度铺底：沉的"体重"，尾随主音略短收束 */
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(108, t0);
    sg.gain.setValueAtTime(0.0001, t0);
    sg.gain.exponentialRampToValueAtTime(0.10, t0 + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.9);
    sub.connect(sg).connect(ctx.destination);
    sub.start(t0); sub.stop(t0 + dur * 0.9 + 0.05);
    /* 极淡高泛音：点睛不刺耳（旧版 1440 同步下调一个八度） */
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'sine';
    o2.frequency.value = 864;
    const od = Math.min(0.5, dur * 0.6);
    g2.gain.setValueAtTime(0.0001, t0);
    g2.gain.exponentialRampToValueAtTime(0.035, t0 + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + od);
    o2.connect(g2).connect(ctx.destination);
    o2.start(t0); o2.stop(t0 + od + 0.05);
  },
  /* 铜磬：轻短促（时期引子/切诗） */
  tongqing() {
    if (!AppState.settings.ritual_sound) return;
    const ctx = this.ensure(); if (!ctx) return;
    const t0 = ctx.currentTime;
    [880, 1320, 1760].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(i === 0 ? 0.10 : 0.04, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9 + i * 0.12);
      o.connect(g).connect(ctx.destination);
      o.start(t0); o.stop(t0 + 1.4);
    });
  },
  /* 嗒：极轻点击 */
  ta() {
    if (!AppState.settings.click_sound) return;
    const ctx = this.ensure(); if (!ctx) return;
    const t0 = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.03, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(g).connect(ctx.destination);
    src.start(t0);
  }
};
