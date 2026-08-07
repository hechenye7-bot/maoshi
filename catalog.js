/* ============================================================
   catalog.js · 目录页：时期导航 + 诗卡 + 引子转场 + 已藏筛选
   ============================================================ */
'use strict';

const Catalog = {
  currentPeriod: null,
  favFilter: false,
  navEl: document.getElementById('period-nav'),
  listEl: document.getElementById('poem-list'),
  quoteEl: null,

  init() {
    this.quoteEl = document.createElement('div');
    this.quoteEl.className = 'period-quote';
    this.quoteEl.innerHTML = '<span class="pq-text"></span>';
    document.body.appendChild(this.quoteEl);

    document.getElementById('btn-fav-filter').addEventListener('click', () => {
      this.favFilter = !this.favFilter;
      document.getElementById('btn-fav-filter').classList.toggle('on', this.favFilter);
      this.renderList();
    });
    document.getElementById('btn-back-player').addEventListener('click', () => {
      Ritual.ta();
      UI.showPlayer({ resume: true });
    });
  },

  renderNav() {
    const groups = AppState.periodsWithCount();
    if (!groups.length) return;
    this.navEl.innerHTML = groups.map((g, i) =>
      `<button class="period-item" data-period="${g.period}">
        <span>${g.period}</span><span class="period-count">${g.count}</span>
      </button>`).join('');
    this.navEl.querySelectorAll('.period-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const per = btn.dataset.period;
        Ritual.ta();
        this.switchPeriod(per);
      });
    });
  },

  /* 时期切换：先全屏引子名句 + 铜磬，再显示诗单 */
  switchPeriod(period, silent) {
    const isSame = this.currentPeriod === period;
    this.currentPeriod = period;
    this.navEl.querySelectorAll('.period-item').forEach(b =>
      b.classList.toggle('active', b.dataset.period === period));

    if (!silent && !isSame) {
      const quote = PERIOD_QUOTES[period] || '';
      this.showQuote(quote);
    } else {
      this.renderList();
    }
  },

  showQuote(text) {
    const q = this.quoteEl;
    q.querySelector('.pq-text').textContent = text;
    q.classList.add('show');
    if (!text) { q.classList.remove('show'); this.renderList(); return; }
    Ritual.tongqing();                 /* 铜磬与引子同步 */
    setTimeout(() => {
      q.classList.remove('show');
      this.renderList();
    }, 1200);                          /* ≤1.2s 完成引子 */
  },

  renderList() {
    if (!this.currentPeriod) return;
    let list = AppState.poemsByPeriod(this.currentPeriod);
    if (this.favFilter) list = list.filter(p => AppState.isFav(p.id));
    if (!list.length) {
      this.listEl.innerHTML = `<div class="poem-card" style="justify-content:center;opacity:.6">此时期暂无已藏诗作</div>`;
      return;
    }
    this.listEl.innerHTML = list.map(p => {
      const read = AppState.read.includes(p.id) ? ' read' : '';
      const fav = AppState.isFav(p.id) ? ' on' : '';
      const firstRaw = (p.lines && p.lines[0] && p.lines[0].sim) || '';
      const first = firstRaw.replace(/[，。；？！、]/g, '').slice(0, 14);
      return `<div class="poem-card${read}" data-id="${p.id}">
        <div class="pc-info">
          <div class="pc-title">${p.title}</div>
          <div class="pc-preview">${first}${first.length >= 14 ? '…' : ''}</div>
          <div class="pc-year">${p.year}</div>
        </div>
        <span class="pc-read" title="已读"></span>
        <button class="pc-fav${fav}" title="收藏">藏</button>
      </div>`;
    }).join('');

    this.listEl.querySelectorAll('.poem-card').forEach(card => {
      const id = parseInt(card.dataset.id, 10);
      card.addEventListener('click', e => {
        if (e.target.classList.contains('pc-fav')) return;
        const poem = AppState.poemById(id);
        if (!poem) return;
        Ritual.ta();
        UI.showPlayer({ poemId: id });
      });
      const favBtn = card.querySelector('.pc-fav');
      favBtn.addEventListener('click', e => {
        e.stopPropagation();
        const on = AppState.toggleFav(id);
        favBtn.classList.toggle('on', on);
        if (this.favFilter) this.renderList();
      });
    });
  },

  refreshReadState() {
    this.listEl.querySelectorAll('.poem-card').forEach(card => {
      const id = parseInt(card.dataset.id, 10);
      card.classList.toggle('read', AppState.read.includes(id));
    });
  }
};

/* 时期名句引子 */
const PERIOD_QUOTES = {
  '早年立志': '问苍茫大地，谁主沉浮',
  '井冈山与根据地': '战地黄花分外香',
  '长征路上': '红军不怕远征难',
  '开国前后': '天翻地覆慨而慷',
  '建设年代': '一桥飞架南北，天堑变通途'
};
