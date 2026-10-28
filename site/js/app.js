const STORAGE_KEYS = {
  THEME: 'bioisle_theme_v1',
  VISITED: 'bioisle_visited_v1',
  REDUCED_MOTION: 'bioisle_reduced_motion_v1'
};

class BioIsleApp {
  constructor() {
    this.data = null;
    this.scene3d = null;
    this.allLocations = []; // [centerIsland, ...islands]
    this.locationMap = new Map();

    this.currentIslandId = null;
    this.currentCategory = '全部';
    this.searchQuery = '';
    this.visitedSet = new Set();

    this.theme = 'morning';
    this.lightMode = 'day';
    this.reducedMotion = false;
  }

  async init() {
    await this.loadContent();
    this.loadPersistedState();
    this.initHeaderAndFooters();
    this.initClockAndDaylight();
    this.initThemeControls();
    this.initReducedMotionControl();
    this.initSearchControls();
    this.initPanelControls();
    this.initDirectoryAndHelpModals();
    this.initKeyboardShortcuts();
    this.updateProgressUI();

    await this.init3DOrFallback();
  }

  async loadContent() {
    const res = await fetch('./data/content.json');
    if (!res.ok) {
      throw new Error(`無法載入 data/content.json (${res.status})`);
    }
    this.data = await res.json();

    const center = {
      ...this.data.centerIsland,
      isCenter: true,
      position: { x: 0, z: 0 }
    };
    this.allLocations = [center, ...this.data.islands];
    this.allLocations.forEach((loc) => {
      this.locationMap.set(loc.id, loc);
    });
  }

  loadPersistedState() {
    try {
      const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
      if (savedTheme && ['morning', 'mist', 'night'].includes(savedTheme)) {
        this.theme = savedTheme;
      }

      const savedVisited = localStorage.getItem(STORAGE_KEYS.VISITED);
      if (savedVisited) {
        const arr = JSON.parse(savedVisited);
        if (Array.isArray(arr)) {
          arr.forEach((id) => {
            if (this.locationMap.has(id)) this.visitedSet.add(id);
          });
        }
      }

      const savedRM = localStorage.getItem(STORAGE_KEYS.REDUCED_MOTION);
      if (savedRM !== null) {
        this.reducedMotion = savedRM === 'true';
      } else if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.reducedMotion = true;
      }
    } catch {
      // Ignore storage access errors in restricted modes
    }

    // Set initial daylight based on local time (05:00-16:59 day, 17:00-18:59 dusk, 19:00-04:59 night)
    const hour = new Date().getHours();
    if (this.theme === 'night') {
      this.lightMode = 'night';
    } else if (hour >= 5 && hour < 17) {
      this.lightMode = 'day';
    } else if (hour >= 17 && hour < 19) {
      this.lightMode = 'dusk';
    } else {
      this.lightMode = 'night';
    }
  }

  initHeaderAndFooters() {
    const { site, webSources, disclaimer } = this.data;
    document.getElementById('site-title-text').textContent = site.title;
    document.getElementById('site-author-text').textContent = site.author;
    document.getElementById('site-tagline-text').textContent = site.tagline;

    // Mascot button opens Central Island
    document.getElementById('grandpa-home-btn').addEventListener('click', () => {
      this.openIsland('center-island');
    });

    // Toast close button
    document.getElementById('grandpa-toast-close').addEventListener('click', () => {
      document.getElementById('grandpa-toast').classList.add('is-hidden');
    });

    // Render mandatory Data Sources & Disclaimer section
    const sourcesHtml = `
      <h4>📚 資料來源與非官方整理聲明</h4>
      <p style="margin: 0 0 8px;">${this.escapeHtml(disclaimer)}</p>
      <p style="margin: 0 0 6px;"><strong>公開資料查詢日期：</strong>2026-10-29｜<strong>作者粉專：</strong><a href="${this.escapeAttr(site.contact)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(site.author)} (${this.escapeHtml(site.contact)})</a></p>
      <ul>
        ${webSources
          .map(
            (s) =>
              `<li><a href="${this.escapeAttr(s.url)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(s.title)}</a> — <code>${this.escapeHtml(s.url)}</code>（查詢日期：${this.escapeHtml(s.fetchedAt)}）</li>`
          )
          .join('')}
      </ul>
    `;
    document.getElementById('directory-sources-footer').innerHTML = sourcesHtml;
    document.getElementById('help-sources-footer').innerHTML = sourcesHtml;
  }

  initClockAndDaylight() {
    const clockEl = document.getElementById('live-clock-text');
    const updateClock = () => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      const labelMap = { day: '白天', dusk: '黃昏', night: '夜晚' };
      clockEl.textContent = `🕒 ${hh}:${mm}:${ss}（${labelMap[this.lightMode] || '白天'}）`;
    };
    updateClock();
    setInterval(updateClock, 1000);

    const lightBtns = document.querySelectorAll('[data-light-option]');
    const syncLightButtons = () => {
      lightBtns.forEach((btn) => {
        const active = btn.dataset.lightOption === this.lightMode;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
      updateClock();
    };
    syncLightButtons();

    lightBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.lightMode = btn.dataset.lightOption;
        syncLightButtons();
        if (this.scene3d) {
          this.scene3d.setLightMode(this.lightMode);
        }
      });
    });

    this.syncLightButtons = syncLightButtons;
  }

  initThemeControls() {
    const themeBtns = document.querySelectorAll('[data-theme-option]');
    const applyTheme = (themeId, userTriggered = false) => {
      this.theme = themeId;
      document.documentElement.setAttribute('data-theme', themeId);
      themeBtns.forEach((btn) => {
        const active = btn.dataset.themeOption === themeId;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
      });

      try {
        localStorage.setItem(STORAGE_KEYS.THEME, themeId);
      } catch {
        // Ignore
      }

      // Per references/theme.md rule 6: switching to dark theme defaults light to night, but user can still switch light back
      if (userTriggered && themeId === 'night') {
        this.lightMode = 'night';
        if (this.syncLightButtons) this.syncLightButtons();
        if (this.scene3d) this.scene3d.setLightMode('night');
      } else if (userTriggered && themeId !== 'night' && this.lightMode === 'night') {
        this.lightMode = 'day';
        if (this.syncLightButtons) this.syncLightButtons();
        if (this.scene3d) this.scene3d.setLightMode('day');
      }

      if (this.scene3d) {
        this.scene3d.setTheme(themeId);
      }
    };

    applyTheme(this.theme, false);

    themeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        applyTheme(btn.dataset.themeOption, true);
      });
    });
  }

  initReducedMotionControl() {
    const rmBtn = document.getElementById('reduced-motion-btn');
    const applyRM = (flag) => {
      this.reducedMotion = Boolean(flag);
      document.documentElement.classList.toggle('reduced-motion', this.reducedMotion);
      rmBtn.classList.toggle('is-active', this.reducedMotion);
      rmBtn.setAttribute('aria-pressed', String(this.reducedMotion));
      rmBtn.innerHTML = this.reducedMotion ? '<span>▶️ 恢復動態</span>' : '<span>⏸️ 減少動態</span>';

      try {
        localStorage.setItem(STORAGE_KEYS.REDUCED_MOTION, String(this.reducedMotion));
      } catch {
        // Ignore
      }

      if (this.scene3d) {
        this.scene3d.setReducedMotion(this.reducedMotion);
      }
    };

    applyRM(this.reducedMotion);

    rmBtn.addEventListener('click', () => {
      applyRM(!this.reducedMotion);
    });
  }

  initSearchControls() {
    const mainSearch = document.getElementById('island-search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    const matchCountEl = document.getElementById('search-match-count');
    const dirSearch = document.getElementById('directory-search-input');

    const handleSearch = (val, fromDirectory = false) => {
      this.searchQuery = val;
      if (!fromDirectory && dirSearch.value !== val) {
        dirSearch.value = val;
      }
      if (fromDirectory && mainSearch.value !== val) {
        mainSearch.value = val;
      }

      const trimmed = val.trim();
      clearBtn.classList.toggle('is-visible', trimmed.length > 0);

      if (this.scene3d) {
        const count = this.scene3d.setSearchFilter(trimmed);
        matchCountEl.textContent = trimmed ? `找到 ${count} 座島` : '';
      }
      this.renderDirectoryCards();
    };

    mainSearch.addEventListener('input', (e) => handleSearch(e.target.value, false));
    dirSearch.addEventListener('input', (e) => handleSearch(e.target.value, true));

    clearBtn.addEventListener('click', () => {
      mainSearch.value = '';
      handleSearch('', false);
      mainSearch.focus();
    });
  }

  initPanelControls() {
    document.getElementById('panel-close-btn').addEventListener('click', () => {
      this.closePanel();
    });

    document.getElementById('panel-overview-btn').addEventListener('click', () => {
      this.closePanel();
    });

    document.getElementById('reset-camera-btn').addEventListener('click', () => {
      this.closePanel();
      if (this.scene3d) {
        this.scene3d.resetOverview();
      }
    });

    document.getElementById('prev-island-btn').addEventListener('click', () => {
      this.stepIsland(-1);
    });

    document.getElementById('next-island-btn').addEventListener('click', () => {
      this.stepIsland(1);
    });

    const resetProgressHandler = () => {
      this.visitedSet.clear();
      try {
        localStorage.removeItem(STORAGE_KEYS.VISITED);
      } catch {
        // Ignore
      }
      this.updateProgressUI();
      if (this.currentIslandId) {
        this.renderPanelContent(this.locationMap.get(this.currentIslandId));
      }
      this.renderDirectoryCards();
    };

    document.getElementById('reset-progress-btn').addEventListener('click', resetProgressHandler);
    document.getElementById('dir-reset-progress-btn').addEventListener('click', resetProgressHandler);
  }

  initDirectoryAndHelpModals() {
    const dirOverlay = document.getElementById('directory-overlay');
    const openDirBtn = document.getElementById('open-directory-btn');
    const closeDirBtn = document.getElementById('close-directory-btn');

    const helpOverlay = document.getElementById('help-overlay');
    const openHelpBtn = document.getElementById('open-help-btn');
    const closeHelpBtn = document.getElementById('close-help-btn');

    this.renderCategoryTabs();
    this.renderDirectoryCards();

    openDirBtn.addEventListener('click', () => this.toggleDirectory(true));
    closeDirBtn.addEventListener('click', () => this.toggleDirectory(false));
    dirOverlay.addEventListener('click', (e) => {
      if (e.target === dirOverlay) this.toggleDirectory(false);
    });

    openHelpBtn.addEventListener('click', () => this.toggleHelp(true));
    closeHelpBtn.addEventListener('click', () => this.toggleHelp(false));
    helpOverlay.addEventListener('click', (e) => {
      if (e.target === helpOverlay) this.toggleHelp(false);
    });
  }

  toggleDirectory(open) {
    const dirOverlay = document.getElementById('directory-overlay');
    const openDirBtn = document.getElementById('open-directory-btn');
    dirOverlay.classList.toggle('is-open', open);
    dirOverlay.setAttribute('aria-hidden', String(!open));
    openDirBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      this.renderCategoryTabs();
      this.renderDirectoryCards();
    }
  }

  toggleHelp(open) {
    const helpOverlay = document.getElementById('help-overlay');
    const openHelpBtn = document.getElementById('open-help-btn');
    helpOverlay.classList.toggle('is-open', open);
    helpOverlay.setAttribute('aria-hidden', String(!open));
    openHelpBtn.setAttribute('aria-expanded', String(open));
  }

  renderCategoryTabs() {
    const container = document.getElementById('directory-category-tabs');
    const counts = { 全部: this.allLocations.length };
    this.allLocations.forEach((loc) => {
      counts[loc.group] = (counts[loc.group] || 0) + 1;
    });

    const categories = ['全部', '中央廣場', '基礎計算', '蛋白質電泳', '蛋白質分析'];
    container.innerHTML = categories
      .map((cat) => {
        const active = this.currentCategory === cat;
        return `
          <button
            type="button"
            role="tab"
            aria-selected="${active}"
            class="cat-tab-btn${active ? ' is-active' : ''}"
            data-cat="${this.escapeAttr(cat)}"
          >
            ${this.escapeHtml(cat)} (${counts[cat] || 0})
          </button>
        `;
      })
      .join('');

    container.querySelectorAll('.cat-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.currentCategory = btn.dataset.cat;
        this.renderCategoryTabs();
        this.renderDirectoryCards();
      });
    });
  }

  renderDirectoryCards() {
    const grid = document.getElementById('directory-grid');
    const q = (this.searchQuery || '').trim().toLowerCase();

    const filtered = this.allLocations.filter((loc) => {
      const catMatch = this.currentCategory === '全部' || loc.group === this.currentCategory;
      if (!catMatch) return false;
      if (!q) return true;
      const hay = [
        loc.name,
        loc.group,
        loc.intro,
        loc.extra,
        loc.webSummary || '',
        ...(loc.points || [])
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 32px; color: var(--muted);">
          找不到符合「<strong>${this.escapeHtml(this.searchQuery)}</strong>」的島嶼，請試試其他關鍵字或切換分類頁籤。
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered
      .map((loc) => {
        const isVisited = this.visitedSet.has(loc.id);
        const orderBadge = loc.isCenter ? '★ 中央島' : `#${loc.order}`;
        const primaryUrl = loc.isCenter ? this.data.site.contact : loc.link;
        const primaryLabel = loc.isCenter ? 'FB 粉專 ↗' : '開啟工具 ↗';

        return `
          <article class="dir-card" data-card-island-id="${this.escapeAttr(loc.id)}">
            <div>
              <div class="panel-badges">
                <span class="badge-group">${this.escapeHtml(orderBadge)}｜${this.escapeHtml(loc.group)}</span>
                <span class="badge-sim">含示意補充</span>
                ${isVisited ? '<span class="badge-group" style="background: var(--accent-soft); color: var(--accent);">✓ 已逛過</span>' : ''}
              </div>
              <h3 class="dir-card-title">${this.escapeHtml(loc.name)}</h3>
              <p class="dir-card-intro">${this.escapeHtml(loc.intro)}</p>
              <p style="margin: 0 0 8px; font-size: 0.82rem; color: var(--primary);">
                <strong>🏛️ ${this.escapeHtml(this.data.extraLabel)}：</strong>${this.escapeHtml(loc.extra)}
              </p>
              <ul class="dir-card-points">
                ${(loc.points || [])
                  .map((pt) => `<li>${this.formatPointHtml(pt)}</li>`)
                  .join('')}
              </ul>
              <div style="font-size: 0.75rem; color: var(--muted); margin-top: 6px;">
                來源：<a href="${this.escapeAttr(loc.sourceUrl)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(loc.sourceUrl)}</a>（查詢：${this.escapeHtml(loc.fetchedAt)}）
              </div>
            </div>
            <div class="dir-card-footer">
              <button
                type="button"
                class="tool-btn open-island-from-dir-btn"
                data-island-id="${this.escapeAttr(loc.id)}"
                style="flex: 1;"
              >
                🏝️ 查看島嶼面板
              </button>
              ${
                primaryUrl
                  ? `<a href="${this.escapeAttr(primaryUrl)}" target="_blank" rel="noopener noreferrer" class="btn-secondary-link" style="min-height: 44px; padding: 6px 12px; font-size: 0.84rem;">
                      ${this.escapeHtml(primaryLabel)}
                    </a>`
                  : ''
              }
            </div>
          </article>
        `;
      })
      .join('');

    grid.querySelectorAll('.open-island-from-dir-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.islandId;
        this.toggleDirectory(false);
        this.openIsland(id);
      });
    });
  }

  openIsland(islandId) {
    const loc = this.locationMap.get(islandId);
    if (!loc) return;

    this.currentIslandId = islandId;
    this.markVisited(islandId);
    this.renderPanelContent(loc);

    const panel = document.getElementById('detail-panel');
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');

    // Hide grandpa welcome toast on mobile so it doesn't crowd the drawer
    document.getElementById('grandpa-toast').classList.add('is-hidden');

    if (this.scene3d) {
      this.scene3d.focusIsland(islandId);
    }
  }

  closePanel() {
    const panel = document.getElementById('detail-panel');
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    this.currentIslandId = null;

    if (this.scene3d) {
      this.scene3d.resetOverview();
    }
  }

  stepIsland(delta) {
    const idx = this.allLocations.findIndex((l) => l.id === this.currentIslandId);
    const nextIdx = idx === -1 ? 0 : (idx + delta + this.allLocations.length) % this.allLocations.length;
    this.openIsland(this.allLocations[nextIdx].id);
  }

  markVisited(islandId) {
    if (!this.visitedSet.has(islandId)) {
      this.visitedSet.add(islandId);
      try {
        localStorage.setItem(STORAGE_KEYS.VISITED, JSON.stringify([...this.visitedSet]));
      } catch {
        // Ignore
      }
      this.updateProgressUI();
    }
  }

  updateProgressUI() {
    const total = this.allLocations.length;
    const count = this.visitedSet.size;
    const counterEl = document.getElementById('progress-counter-text');
    if (counterEl) {
      counterEl.textContent = `🚩 已逛 ${count} / ${total}`;
    }
    if (this.scene3d) {
      this.scene3d.updateVisitedBadges(this.visitedSet);
    }
  }

  renderPanelContent(loc) {
    const badgesEl = document.getElementById('panel-badges');
    const titleEl = document.getElementById('panel-title');
    const bodyEl = document.getElementById('panel-body');

    const orderLabel = loc.isCenter ? '★ 中央廣場' : `第 ${loc.order} 島｜${loc.group}`;
    badgesEl.innerHTML = `
      <span class="badge-group">${this.escapeHtml(orderLabel)}</span>
      <span class="badge-sim" title="本島代表建築設定、阿公小叮嚀與部分補充說明為示意內容">示意補充</span>
      ${this.visitedSet.has(loc.id) ? '<span class="badge-group" style="background: var(--accent-soft); color: var(--accent);">✓ 已探索</span>' : ''}
    `;
    titleEl.textContent = loc.name;

    if (loc.isCenter) {
      const catCounts = { 基礎計算: 0, 蛋白質電泳: 0, 蛋白質分析: 0 };
      this.data.islands.forEach((i) => {
        catCounts[i.group] = (catCounts[i.group] || 0) + 1;
      });

      bodyEl.innerHTML = `
        <p class="panel-intro">${this.escapeHtml(loc.intro)}</p>

        <div class="grandpa-tip-box">
          <div style="font-size: 1.5rem;" aria-hidden="true">🥼</div>
          <div class="grandpa-tip-content">
            <strong>阿公迎賓導覽（示意）</strong>
            ${this.escapeHtml(this.data.site.mascot.welcomeSpeech)}
          </div>
        </div>

        <section class="panel-section">
          <h3 class="panel-section-title">
            <span>👋 關於「${this.escapeHtml(this.data.site.author)}」</span>
            <span class="badge-sim">示意</span>
          </h3>
          <p style="margin: 0 0 8px; font-size: 0.9rem;">${this.escapeHtml(loc.bioSummary)}</p>
          <p style="margin: 0; font-size: 0.84rem; color: var(--muted);">
            🎯 <strong>主要受眾：</strong>${this.escapeHtml(this.data.site.audience)}｜🔒 ${this.escapeHtml(this.data.site.privacyNote)}
          </p>
        </section>

        <section class="panel-section">
          <h3 class="panel-section-title">
            <span>🏛️ ${this.escapeHtml(this.data.extraLabel)}</span>
            <span class="badge-sim">示意</span>
          </h3>
          <p style="margin: 0; font-size: 0.9rem;">${this.escapeHtml(loc.extra)}</p>
        </section>

        <section class="panel-section">
          <h3 class="panel-section-title"><span>🧭 前往三大實驗分區總覽</span></h3>
          <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;">
            ${Object.entries(catCounts)
              .map(
                ([cat, cnt]) => `
                <button type="button" class="tool-btn panel-cat-jump-btn" data-jump-cat="${this.escapeAttr(cat)}">
                  📂 ${this.escapeHtml(cat)} (${cnt} 座島)
                </button>
              `
              )
              .join('')}
          </div>
          <ul class="points-list">
            ${(loc.points || []).map((p) => `<li>${this.formatPointHtml(p)}</li>`).join('')}
          </ul>
        </section>

        <div class="panel-actions">
          ${(loc.links || [])
            .map((lnk) =>
              lnk.primary
                ? `<a href="${this.escapeAttr(lnk.url)}" target="_blank" rel="noopener noreferrer" class="btn-primary-link">🔗 ${this.escapeHtml(lnk.label)} ↗</a>`
                : `<a href="${this.escapeAttr(lnk.url)}" target="_blank" rel="noopener noreferrer" class="btn-secondary-link">🧰 ${this.escapeHtml(lnk.label)} ↗</a>`
            )
            .join('')}
        </div>

        <div class="source-meta">
          資料來源：<a href="${this.escapeAttr(loc.sourceUrl)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(loc.sourceUrl)}</a>（查詢日期：${this.escapeHtml(loc.fetchedAt)}）<br/>
          ${this.escapeHtml(this.data.disclaimer)}
        </div>
      `;

      bodyEl.querySelectorAll('.panel-cat-jump-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.currentCategory = btn.dataset.jumpCat;
          this.toggleDirectory(true);
        });
      });
    } else {
      bodyEl.innerHTML = `
        <p class="panel-intro">${this.escapeHtml(loc.intro)}</p>

        <section class="panel-section">
          <h3 class="panel-section-title">
            <span>📌 內容重點與工具摘要</span>
          </h3>
          <p style="margin: 0 0 10px; font-size: 0.88rem; color: var(--muted);">
            ${this.escapeHtml(loc.webSummary || '')}
          </p>
          <ul class="points-list">
            ${(loc.points || []).map((p) => `<li>${this.formatPointHtml(p)}</li>`).join('')}
          </ul>
        </section>

        <section class="panel-section">
          <h3 class="panel-section-title">
            <span>🏛️ ${this.escapeHtml(this.data.extraLabel)}</span>
            <span class="badge-sim">示意</span>
          </h3>
          <p style="margin: 0; font-size: 0.9rem;">${this.escapeHtml(loc.extra)}</p>
        </section>

        <div class="grandpa-tip-box">
          <div style="font-size: 1.5rem;" aria-hidden="true">🥼</div>
          <div class="grandpa-tip-content">
            <strong>阿公實驗小叮嚀（示意）</strong>
            ${this.escapeHtml(loc.grandpaTip || '')}
          </div>
        </div>

        <div class="panel-actions">
          ${
            loc.link
              ? `<a href="${this.escapeAttr(loc.link)}" target="_blank" rel="noopener noreferrer" class="btn-primary-link">
                  🚀 開啟「${this.escapeHtml(loc.name)}」線上工具 ↗
                </a>`
              : ''
          }
          ${(loc.secondaryLinks || [])
            .map(
              (sl) => `
              <a href="${this.escapeAttr(sl.url)}" target="_blank" rel="noopener noreferrer" class="btn-secondary-link">
                📖 ${this.escapeHtml(sl.label)} ↗
              </a>
            `
            )
            .join('')}
        </div>

        <div class="source-meta">
          公開資料來源：<a href="${this.escapeAttr(loc.sourceUrl)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(loc.sourceUrl)}</a>｜查詢日期：${this.escapeHtml(loc.fetchedAt)}<br/>
          ${this.escapeHtml(this.data.disclaimer)}
        </div>
      `;
    }
  }

  initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const helpOverlay = document.getElementById('help-overlay');
        const dirOverlay = document.getElementById('directory-overlay');
        const detailPanel = document.getElementById('detail-panel');

        if (helpOverlay.classList.contains('is-open')) {
          this.toggleHelp(false);
        } else if (dirOverlay.classList.contains('is-open')) {
          this.toggleDirectory(false);
        } else if (detailPanel.classList.contains('is-open')) {
          this.closePanel();
        }
      }
    });
  }

  async init3DOrFallback() {
    const params = new URLSearchParams(window.location.search);
    const forceNoWebGL = params.get('nowebgl') === '1';

    let webglSupported = false;
    if (!forceNoWebGL) {
      try {
        const testCanvas = document.createElement('canvas');
        webglSupported = Boolean(
          window.WebGLRenderingContext &&
            (testCanvas.getContext('webgl2') ||
              testCanvas.getContext('webgl') ||
              testCanvas.getContext('experimental-webgl'))
        );
      } catch {
        webglSupported = false;
      }
    }

    if (!webglSupported) {
      this.activateWebGLFallback();
      return;
    }

    try {
      const { BioArchipelagoScene } = await import('./scene3d.js');
      this.scene3d = new BioArchipelagoScene({
        container: document.getElementById('canvas-container'),
        labelsContainer: document.getElementById('labels-container'),
        svgLayer: document.getElementById('labels-svg-layer'),
        data: this.data,
        isReducedMotion: this.reducedMotion,
        onSelectIsland: (id) => this.openIsland(id)
      });

      this.scene3d.setTheme(this.theme);
      this.scene3d.setLightMode(this.lightMode);
      this.scene3d.updateVisitedBadges(this.visitedSet);
    } catch {
      this.activateWebGLFallback();
    }
  }

  activateWebGLFallback() {
    const banner = document.getElementById('webgl-fallback-banner');
    if (banner) banner.classList.add('is-visible');
    this.toggleDirectory(true);
  }

  formatPointHtml(pt) {
    const str = String(pt || '');
    if (str.startsWith('http://') || str.startsWith('https://')) {
      return `<a href="${this.escapeAttr(str)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(str)}</a>`;
    }
    return this.escapeHtml(str);
  }

  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  escapeAttr(str) {
    return this.escapeHtml(str);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new BioIsleApp();
  app.init();
});
