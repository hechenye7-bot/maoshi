/* ============================================================
   data.js · 数据加载与本地状态
   ============================================================ */
'use strict';

const Store = {
  key: {
    font: 'settings.font',
    font_size: 'settings.font_size',
    bright: 'settings.bright',
    bgm_id: 'settings.bgm_id',
    bgm_on: 'settings.bgm_on',
    bgm_volume: 'settings.bgm_volume',
    atmosphere: 'settings.atmosphere',
    subtitle: 'settings.subtitle',
    ritual: 'settings.ritual_sound',
    click: 'settings.click_sound',
    favorites: 'favorites',
    read: 'read',
    last_poem: 'last_poem'
  },
  get(k, def) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? def : JSON.parse(v);
    } catch (e) { return def; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
};

const AppState = {
  poems: [],
  bgms: [],
  periods: ['早年立志', '井冈山与根据地', '长征路上', '开国前后', '建设年代'],
  current: null,        // 当前诗对象
  settings: {
    font: 'stele',        // 默认碑刻
    font_size: 'l',       // 默认大字
    bright: 0.4,          // 默认文字亮度最低（滑杆 min=0.4）
    atmosphere: 'off',    // 默认氛围浓度关
    bgm_id: null,
    bgm_on: true,         // BGM 打开
    bgm_volume: 0.25,     // BGM 音量 25%（兼顾不吵与可听）
    subtitle: false,      // 字幕关闭
    ritual_sound: true,   // 仪式音打开
    click_sound: true     // 点击音打开
  },
  favorites: [],        // [poemId]
  read: [],             // [poemId]
  view: 'intro'         // intro | player | catalog

  , load() {
    // 每次打开网页强制恢复默认设置，覆盖 localStorage 中用户上次的设置
    this.settings = {
      font: 'stele',
      font_size: 'l',
      bright: 0.4,
      atmosphere: 'off',
      bgm_id: null,
      bgm_on: true,
      bgm_volume: 0.25,
      subtitle: false,
      ritual_sound: true,
      click_sound: true
    };
    this.saveSettings();
    this.favorites = Store.get(Store.key.favorites, []);
    this.read = Store.get(Store.key.read, []);
  },
  saveSettings() {
    Store.set(Store.key.font, this.settings.font);
    Store.set(Store.key.font_size, this.settings.font_size);
    Store.set(Store.key.bright, this.settings.bright);
    Store.set(Store.key.bgm_id, this.settings.bgm_id);
    Store.set(Store.key.bgm_on, this.settings.bgm_on);
    Store.set(Store.key.bgm_volume, this.settings.bgm_volume);
    Store.set(Store.key.atmosphere, this.settings.atmosphere);
    Store.set(Store.key.subtitle, this.settings.subtitle);
    Store.set(Store.key.ritual_sound, this.settings.ritual_sound);
    Store.set(Store.key.click_sound, this.settings.click_sound);
  },
  isFav(id) { return this.favorites.includes(id); },
  toggleFav(id) {
    const i = this.favorites.indexOf(id);
    if (i >= 0) this.favorites.splice(i, 1); else this.favorites.push(id);
    Store.set(Store.key.favorites, this.favorites);
    return this.isFav(id);
  },
  markRead(id) {
    if (!this.read.includes(id)) {
      this.read.push(id);
      Store.set(Store.key.read, this.read);
    }
  },
  saveLastPoem(id, playing, t) {
    Store.set(Store.key.last_poem, { id, playing, t });
  },
  loadLastPoem() { return Store.get(Store.key.last_poem, null); },
  poemById(id) {
    return this.poems.find(p => p.id === id) || null;
  },
  poemsByPeriod(period) {
    return this.poems.filter(p => p.period === period).sort((a, b) => a.sort - b.sort);
  },
  periodsWithCount() {
    return this.periods.map(per => ({
      period: per,
      count: this.poems.filter(p => p.period === per).length
    })).filter(x => x.count > 0);
  }
};

/* 获取诗词数据 */
async function loadPoems() {
  try {
    const res = await fetch('data/poems.json?v=' + VERSION, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    AppState.poems = json.poems || [];
    AppState.bgms = json.bgms || [];
    if (!AppState.poems.length) throw new Error('空数据');
    return true;
  } catch (e) {
    console.error('数据加载失败', e);
    Toast.show('数据加载失败，请稍后重试');
    return false;
  }
}
