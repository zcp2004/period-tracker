// ====== 乖宝生理期 - 主应用逻辑 ======

// Server URL: browser uses page origin; APK (file://) uses stored IP
const STORED_SERVER = localStorage.getItem('server_url') || '';
const API_BASE = STORED_SERVER || window.location.origin;

const APP = {
  state: {
    auth: {
      token: localStorage.getItem('period_token') || '',
      user: null,
      boundUser: null,
    },
    records: [],
    dailyLogs: {},
    symptoms: [],
    meals: [],
    tags: [],
    settings: {
      blurPreview: true,
      notifications: true,
      darkMode: false,
      partnerSync: false,
      partnerCode: '',
      lastPeriodStart: '',
      role: '',
      typicalPeriodDays: 5,
      typicalCycle: 28,
      showOvulation: false,
      setupDone: false,
    },
    partnerMessages: [],
    prediction: null,
    stats: null,
    currentMonth: new Date(),
    selectedMood: 'calm',
    selectedFlow: 0,
    selectedTags: [],
    selectedMealTags: [],
    currentTab: 'calendar',
    editRecordId: null,
    editMealId: null,
    dietFilter: 'all',
  },

  init() {
    this.loadState();
    this.showSplash();
  },

  showSetupWizard() {
    const overlay = document.getElementById('setup-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    document.getElementById('setup-period-start').value = '';
    document.getElementById('setup-period-days').value = 5;
    document.getElementById('setup-cycle').value = 28;
  },

  saveSetup() {
    const start = document.getElementById('setup-period-start').value;
    const days = parseInt(document.getElementById('setup-period-days').value) || 5;
    const cycle = parseInt(document.getElementById('setup-cycle').value) || 28;
    if (!start) { this.showToast('请选择上次经期开始日期'); return; }
    this.state.settings.lastPeriodStart = start;
    this.state.settings.typicalPeriodDays = Math.max(2, Math.min(10, days));
    this.state.settings.typicalCycle = Math.max(21, Math.min(45, cycle));
    this.state.settings.setupDone = true;
    // Create initial record
    this.state.records.push({ id: Date.now(), startDate: start, endDate: null, notes: '' });
    this.saveState();
    this.computePrediction();
    this.computeStats();
    document.getElementById('setup-overlay').classList.add('hidden');
    this.renderCalendar();
    this.updatePhaseBanner();
    this.showToast('设置完成！日历已显示预测周期');
  },

  // ====== Storage ======
  loadState() {
    try {
      const data = localStorage.getItem('period_tracker_data');
      if (data) {
        const parsed = JSON.parse(data);
        // Don't overwrite auth state from localStorage — it's managed separately
        this.state.records = parsed.records || [];
        this.state.dailyLogs = parsed.dailyLogs || {};
        this.state.symptoms = parsed.symptoms || [];
        this.state.meals = parsed.meals || [];
        this.state.tags = parsed.tags?.length ? parsed.tags : [...DEFAULT_TAGS];
        this.state.settings = {...this.state.settings, ...(parsed.settings || {})};
        this.state.partnerMessages = parsed.partnerMessages || [];
        if (parsed.currentTab) this.state.currentTab = parsed.currentTab;
      } else {
        this.state.tags = [...DEFAULT_TAGS];
      }
      if (!this.state.settings.partnerCode) {
        this.state.settings.partnerCode = this.generateCode();
      }
    } catch(e) { console.warn('Load error:', e); }
  },

  saveState() {
    try {
      localStorage.setItem('period_tracker_data', JSON.stringify({
        records: this.state.records,
        dailyLogs: this.state.dailyLogs,
        symptoms: this.state.symptoms,
        meals: this.state.meals,
        tags: this.state.tags,
        settings: this.state.settings,
        partnerMessages: this.state.partnerMessages,
        currentTab: this.state.currentTab,
      }));
      // Sync to server if logged in (debounced)
      if (this.state.auth.token && this.state.auth.user?.role === 'girl') {
        if (this._syncTimer) clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(() => this.syncAllData(), 2000);
      }
    } catch(e) { console.warn('Save error:', e); }
  },

  generateCode() {
    return 'GB' + Array.from({length:6},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random()*32|0]).join('');
  },

  // ====== Splash & Auth ======
  showSplash() {
    setTimeout(() => {
      const splash = document.getElementById('splash-screen');
      splash.classList.add('fade-out');
      setTimeout(() => {
        splash.classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        this.checkAuth();
      }, 500);
    }, 1500);
  },

  async checkAuth() {
    const token = this.state.auth.token;
    if (token) {
      try {
        const resp = await fetch(API_BASE + '/api/user', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (resp.ok) {
          const data = await resp.json();
          this.state.auth.user = data.user;
          this.state.auth.boundUser = data.bound_user;
          this.state.settings.role = data.user.role;
          this.state.settings.partnerCode = data.user.bind_code || '';
          // Fetch data from server
          await this.fetchAllData();
          this.initApp();
          this.updateLoginUI();
          return;
        }
      } catch(e) {}
      // Token invalid
      localStorage.removeItem('period_token');
      this.state.auth.token = '';
    }
    // Not logged in — show login after local init
    this.initApp();
    this.showLoginOverlay();
  },

  showLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('hidden');
  },

  hideLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.add('hidden');
  },

  updateLoginUI() {
    const user = this.state.auth.user;
    const bar = document.getElementById('user-info-bar');
    const form = document.getElementById('login-form');
    const regForm = document.getElementById('register-form');
    if (user) {
      bar.classList.remove('hidden');
      form.classList.add('hidden');
      regForm.classList.add('hidden');
      document.getElementById('user-phone-display').textContent = user.phone;
      document.getElementById('user-role-display').textContent = user.role === 'girl' ? '女生' : '男友';
      const boundInfo = document.getElementById('bound-info');
      if (this.state.auth.boundUser) {
        boundInfo.classList.remove('hidden');
        boundInfo.textContent = '已绑定: ' + this.state.auth.boundUser.phone;
      } else if (user.role === 'boy') {
        boundInfo.classList.remove('hidden');
        boundInfo.textContent = '尚未绑定伴侣';
      } else {
        boundInfo.classList.add('hidden');
      }
      // Role-based tab bar
      this.setupRoleTabs();
    } else {
      bar.classList.add('hidden');
      form.classList.remove('hidden');
      regForm.classList.add('hidden');
      // Reset tab bar to default
      document.body.classList.remove('boy-role');
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('tab-btn-boy'));
      const bfBtn = document.querySelector('.tab-btn[data-tab="boyfriend"]');
      if (bfBtn) bfBtn.classList.add('hidden');
    }
  },

  setupRoleTabs() {
    const role = this.state.auth.user?.role;
    const tabBar = document.getElementById('tab-bar');
    if (role === 'boy') {
      document.body.classList.add('boy-role');
      // Boyfriend tab is separate
      document.querySelectorAll('.tab-btn').forEach(btn => {
        if (['boyfriend','settings'].includes(btn.dataset.tab)) {
          btn.classList.remove('hidden');
          btn.classList.add('tab-btn-boy');
        } else {
          btn.classList.remove('tab-btn-boy');
        }
      });
      // Show boyfriend tab by default
      this.switchTab('boyfriend');
    } else {
      document.body.classList.remove('boy-role');
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('tab-btn-boy'));
      this.restoreTab();
    }
  },

  switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.classList.add('active');
    const page = document.getElementById('page-' + tabName);
    if (page) page.classList.add('active');
    this.state.currentTab = tabName;
    if (tabName === 'boyfriend') this.renderBoyfriendDashboard();
    if (tabName === 'stats') this.renderStats();
  },

  // ====== Auth API calls ======
  async loginAction() {
    const phone = document.getElementById('login-phone').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const errEl = document.getElementById('login-error');
    if (!phone || !password) { errEl.textContent = '请填写手机号和密码'; errEl.classList.remove('hidden'); return; }
    try {
      const resp = await fetch(API_BASE + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password })
      });
      const data = await resp.json();
      if (!resp.ok) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
      errEl.classList.add('hidden');
      this.state.auth.token = data.token;
      this.state.auth.user = data.user;
      this.state.auth.boundUser = null;
      this.state.settings.role = data.user.role;
      this.state.settings.partnerCode = data.user.bind_code || '';
      localStorage.setItem('period_token', data.token);
      await this.fetchAllData();
      this.updateLoginUI();
      this.hideLoginOverlay();
      this.initApp();
      this.showToast('登录成功');
    } catch(e) {
      errEl.textContent = '网络错误，请检查服务器连接';
      errEl.classList.remove('hidden');
    }
  },

  async registerAction() {
    const phone = document.getElementById('reg-phone').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const role = document.querySelector('#register-form .role-btn.active')?.dataset?.role || 'girl';
    const errEl = document.getElementById('login-error');
    if (!phone || password.length < 6) { errEl.textContent = '请填写手机号，密码至少6位'; errEl.classList.remove('hidden'); return; }
    try {
      const resp = await fetch(API_BASE + '/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password, role })
      });
      const data = await resp.json();
      if (!resp.ok) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
      errEl.classList.add('hidden');
      this.state.auth.token = data.token;
      this.state.auth.user = data.user;
      this.state.settings.role = data.user.role;
      this.state.settings.partnerCode = data.user.bind_code || '';
      localStorage.setItem('period_token', data.token);
      this.hideLoginOverlay();
      this.initApp();
      this.updateLoginUI();
      if (role === 'boy') {
        this.showBindOverlay();
      } else {
        // If girl with existing data, upload
        if (this.state.records.length > 0) this.syncAllData();
      }
      this.showToast('注册成功');
    } catch(e) {
      errEl.textContent = '网络错误，请检查服务器连接';
      errEl.classList.remove('hidden');
    }
  },

  showServerPrompt() {
    const serverUrl = prompt('📡 APK运行需要连接服务器\n\n请输入电脑端显示的IP地址和端口（例如 http://192.168.2.53:8890）\n\n设置后可在"设置→服务器连接"中修改');
    if (serverUrl && serverUrl.trim()) {
      localStorage.setItem('server_url', serverUrl.trim().replace(/\/+$/, ''));
      this.showToast('地址已保存，请重启APP');
    } else {
      this.showToast('未设置服务器地址，先使用网页版吧');
    }
  },

  showBindOverlay() {
    document.getElementById('bind-overlay')?.classList.remove('hidden');
  },

  hideBindOverlay() {
    document.getElementById('bind-overlay')?.classList.add('hidden');
  },

  async bindAction() {
    const code = document.getElementById('bind-code-input').value.trim().toUpperCase();
    const errEl = document.getElementById('bind-error');
    if (!code) { errEl.textContent = '请输入绑定码'; errEl.classList.remove('hidden'); return; }
    try {
      const resp = await fetch(API_BASE + '/api/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.state.auth.token },
        body: JSON.stringify({ bind_code: code })
      });
      const data = await resp.json();
      if (!resp.ok) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
      errEl.classList.add('hidden');
      this.hideBindOverlay();
      // Refresh user info
      await this.checkAuth();
      this.showToast('绑定成功！');
    } catch(e) {
      errEl.textContent = '网络错误';
      errEl.classList.remove('hidden');
    }
  },

  logout() {
    this.state.auth.token = '';
    this.state.auth.user = null;
    this.state.auth.boundUser = null;
    localStorage.removeItem('period_token');
    this.updateLoginUI();
    document.body.classList.remove('boy-role');
    this.showLoginOverlay();
    this.showToast('已退出登录');
  },

  // ====== API Data Sync ======
  async fetchAllData() {
    const token = this.state.auth.token;
    if (!token) return;
    try {
      const [recResp, symResp, mealResp, msgResp] = await Promise.all([
        fetch(API_BASE + '/api/records', { headers: { 'Authorization': 'Bearer ' + token } }),
        fetch(API_BASE + '/api/symptoms', { headers: { 'Authorization': 'Bearer ' + token } }),
        fetch(API_BASE + '/api/meals', { headers: { 'Authorization': 'Bearer ' + token } }),
        fetch(API_BASE + '/api/partner-messages', { headers: { 'Authorization': 'Bearer ' + token } }),
      ]);
      if (recResp.ok) {
        const data = await recResp.json();
        if (data.records && data.records.length > 0) {
          this.state.records = data.records.map(r => ({
            id: r.id, startDate: r.start_date, endDate: r.end_date,
            notes: r.notes || '', ongoingDates: JSON.parse(r.ongoing_dates || '[]')
          }));
        }
      }
      if (symResp.ok) {
        const data = await symResp.json();
        if (data.symptoms && data.symptoms.length > 0) {
          this.state.symptoms = data.symptoms.map(s => ({
            id: s.id, date: s.date, painLevel: s.pain_level, flowLevel: s.flow_level,
            mood: s.mood, customTags: JSON.parse(s.tags || '[]'), note: s.notes || ''
          }));
        }
      }
      if (mealResp.ok) {
        const data = await mealResp.json();
        if (data.meals && data.meals.length > 0) {
          this.state.meals = data.meals.map(m => ({
            id: m.id, type: m.type, date: m.date, content: m.content || '',
            note: m.note || '', tags: JSON.parse(m.tags || '[]'), photo: m.photo || ''
          }));
        }
      }
      if (msgResp.ok) {
        const data = await msgResp.json();
        if (data.messages) {
          this.state.partnerMessages = data.messages.map(m => ({
            text: m.message, time: m.created_at?.slice(11,16) || '',
            date: m.created_at?.slice(0,10) || '', from: 'partner'
          }));
        }
      }
    } catch(e) { console.warn('Fetch error:', e); }
  },

  async syncAllData() {
    const token = this.state.auth.token;
    if (!token) return;
    try {
      // Records
      const recordsPayload = this.state.records.map(r => ({
        startDate: r.startDate, endDate: r.endDate || null,
        notes: r.notes || '', ongoingDates: r.ongoingDates || []
      }));
      await fetch(API_BASE + '/api/records', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ records: recordsPayload })
      });
      // Symptoms
      const symPayload = this.state.symptoms.map(s => ({
        date: s.date, painLevel: s.painLevel, flowLevel: s.flowLevel,
        mood: s.mood, tags: s.customTags || [], notes: s.note || ''
      }));
      await fetch(API_BASE + '/api/symptoms', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ symptoms: symPayload })
      });
      // Meals
      const mealPayload = this.state.meals.map(m => ({
        type: m.type, date: m.date, content: m.content || '',
        note: m.note || '', tags: m.tags || [], photo: m.photo || ''
      }));
      await fetch(API_BASE + '/api/meals', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ meals: mealPayload })
      });
    } catch(e) { console.warn('Sync error:', e); }
  },

  // ====== Init ======
  restoreTab() {
    const tab = this.state.currentTab;
    document.querySelectorAll('.tab-btn').forEach(b => {
      const isActive = b.dataset.tab === tab;
      b.classList.toggle('active', isActive);
    });
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('page-' + tab);
    if (page) page.classList.add('active');
  },

  initApp() {
    // If running from APK (file://) and no server configured, show prompt
    if (window.location.origin === 'file://' && !localStorage.getItem('server_url')) {
      this.showServerPrompt();
    }
    const role = this.state.auth.user?.role || this.state.settings.role;
    // Only show setup wizard for unauthenticated users with no data
    if (!this.state.auth.token && !role && !this.state.settings.setupDone && this.state.records.length === 0) {
      this.showSetupWizard();
    }
    this.computePrediction();
    this.computeStats();
    this.renderCalendar();
    this.renderLog();
    this.renderDiet();
    this.renderStats();
    this.renderPartner();
    this.renderSettings();
    this.restoreTab();
    this.bindEvents();
    this.updatePhaseBanner();
    this.initYearMonthPicker();
    document.getElementById('log-date').textContent = new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
    // Notifications
    if (this.state.settings.notifications) this.requestNotifyPermission();
    this.schedulePeriodReminder();
    if (this._reminderInterval) clearInterval(this._reminderInterval);
    this._reminderInterval = setInterval(() => this.schedulePeriodReminder(), 3600000); // check hourly
  },

  bindEvents() {
    const safe = (fn) => { try { fn(); } catch(e) { console.warn(e); } };

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => safe(() => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const page = document.getElementById('page-' + btn.dataset.tab);
        if (page) page.classList.add('active');
        this.state.currentTab = btn.dataset.tab;
        if (btn.dataset.tab === 'stats') this.renderStats();
        if (btn.dataset.tab === 'diet') this.renderDiet();
        if (btn.dataset.tab === 'boyfriend') this.renderBoyfriendDashboard();
      }));
    });

    // Old period modal (removed, keep for backward compat)
    ['btn-period-save','btn-period-delete','btn-period-cancel','btn-still-ongoing','btn-period-ended'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => {});
    });

    // Meal modal
    document.getElementById('btn-add-meal').addEventListener('click', () => safe(() => this.openMealModal()));
    document.getElementById('btn-meal-save').addEventListener('click', () => safe(() => this.saveMeal()));
    document.getElementById('btn-meal-delete').addEventListener('click', () => safe(() => this.deleteMeal()));
    document.getElementById('btn-meal-cancel').addEventListener('click', () => safe(() => this.closeMealModal()));

    // Diet inner tabs
    document.querySelectorAll('.diet-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => safe(() => {
        document.querySelectorAll('.diet-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.diet-tab-content').forEach(c => c.classList.add('hidden'));
        const tab = document.getElementById('diet-' + btn.dataset.dtab);
        if (tab) tab.classList.remove('hidden');
      }));
    });

    // Diet filter
    document.querySelectorAll('.diet-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => safe(() => {
        document.querySelectorAll('.diet-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.dietFilter = btn.dataset.filter;
        this.renderMeals();
      }));
    });

    // Meal tags
    const mealTags = document.getElementById('meal-tags');
    if (mealTags) {
      mealTags.addEventListener('click', (e) => safe(() => {
        const btn = e.target.closest('.tag-btn');
        if (!btn) return;
        btn.classList.toggle('active');
        const tag = btn.dataset.tag;
        if (this.state.selectedMealTags.includes(tag))
          this.state.selectedMealTags = this.state.selectedMealTags.filter(t => t !== tag);
        else
          this.state.selectedMealTags.push(tag);
      }));
    }

    // Meal photo upload
    const photoInput = document.getElementById('meal-photo');
    if (photoInput) {
      photoInput.addEventListener('change', (e) => safe(() => {
        const file = e.target.files[0];
        if (!file) return;
        this._compressImage(file, (dataUrl) => {
          if (dataUrl) {
            this._pendingMealPhoto = dataUrl;
            document.getElementById('meal-photo-name').textContent = file.name;
          }
          this._displayMealPhoto(dataUrl);
        });
      }));
    }
    document.getElementById('btn-meal-photo-remove').addEventListener('click', () => safe(() => {
      this._pendingMealPhoto = null;
      document.getElementById('meal-photo-preview').classList.add('hidden');
      document.getElementById('meal-photo-name').textContent = '';
      document.getElementById('meal-photo').value = '';
    }));

    // Log: pain slider
    const painSlider = document.getElementById('pain-level');
    if (painSlider) {
      painSlider.addEventListener('input', () => {
        const display = document.getElementById('pain-display');
        if (display) display.textContent = painSlider.value + ' 级';
      });
    }

    // Log: flow
    document.querySelectorAll('#flow-group .opt-btn').forEach(btn => {
      btn.addEventListener('click', () => safe(() => {
        document.querySelectorAll('#flow-group .opt-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.selectedFlow = parseInt(btn.dataset.value);
      }));
    });

    // Log: mood
    document.querySelectorAll('.mood-btn').forEach(btn => {
      btn.addEventListener('click', () => safe(() => {
        document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.selectedMood = btn.dataset.mood;
      }));
    });

    // Log: tags
    this.renderTags();
    document.getElementById('btn-save-log').addEventListener('click', () => safe(() => this.saveLog()));

    // Partner AI
    document.getElementById('btn-ai-analyze').addEventListener('click', () => safe(() => this.generateAiSuggestion()));
    // Mami messages
    document.getElementById('btn-mami-send').addEventListener('click', () => safe(() => this.sendMamiMessage()));
    document.getElementById('mami-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') safe(() => this.sendMamiMessage());
    });

    // Settings
    document.getElementById('setting-blur').addEventListener('change', e => safe(() => {
      this.state.settings.blurPreview = e.target.checked;
      this.saveState();
    }));
    document.getElementById('setting-notify').addEventListener('change', e => safe(() => {
      this.state.settings.notifications = e.target.checked;
      this.saveState();
      if (e.target.checked) this.requestNotifyPermission();
    }));
    document.getElementById('setting-dark').addEventListener('change', e => safe(() => {
      this.state.settings.darkMode = e.target.checked;
      document.body.classList.toggle('dark', e.target.checked);
      this.saveState();
    }));
    document.getElementById('btn-export').addEventListener('click', () => safe(() => this.exportData()));
    document.getElementById('btn-import').addEventListener('click', () => safe(() => this.importData()));
    document.getElementById('btn-clear').addEventListener('click', () => safe(() => this.clearData()));

    // Login / Register / Bind events
    document.getElementById('btn-login').addEventListener('click', () => safe(() => this.loginAction()));
    document.getElementById('btn-register').addEventListener('click', () => safe(() => this.registerAction()));
    document.getElementById('btn-show-register').addEventListener('click', () => safe(() => {
      document.getElementById('login-form').classList.add('hidden');
      document.getElementById('register-form').classList.remove('hidden');
      document.getElementById('login-error').classList.add('hidden');
    }));
    document.getElementById('btn-show-login').addEventListener('click', () => safe(() => {
      document.getElementById('register-form').classList.add('hidden');
      document.getElementById('login-form').classList.remove('hidden');
      document.getElementById('login-error').classList.add('hidden');
    }));
    document.getElementById('btn-logout').addEventListener('click', () => safe(() => this.logout()));
    document.getElementById('btn-bind').addEventListener('click', () => safe(() => this.bindAction()));
    document.getElementById('btn-skip-bind').addEventListener('click', () => safe(() => {
      this.hideBindOverlay();
      this.initApp();
    }));
    // Role toggle in register
    document.querySelectorAll('#register-form .role-btn').forEach(btn => {
      btn.addEventListener('click', () => safe(() => {
        document.querySelectorAll('#register-form .role-btn').forEach(b => {
          b.style.borderColor = 'var(--border)';
          b.style.background = 'var(--bg)';
          b.style.color = 'var(--text-secondary)';
        });
        btn.style.borderColor = 'var(--pink)';
        btn.style.background = 'var(--pink-light)';
        btn.style.color = 'var(--pink)';
        document.querySelectorAll('#register-form .role-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }));
    });
    // Bind code enter key
    document.getElementById('bind-code-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') safe(() => this.bindAction());
    });
    // Login enter key
    document.getElementById('login-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') safe(() => this.loginAction());
    });
    document.getElementById('reg-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') safe(() => this.registerAction());
    });

    // Setup wizard
    const setupBtn = document.getElementById('btn-setup-save');
    if (setupBtn) setupBtn.addEventListener('click', () => safe(() => this.saveSetup()));

    // Quick panel
    document.getElementById('btn-qp-close').addEventListener('click', () => safe(() => this.hideQuickPanel()));
    document.getElementById('btn-qp-period').addEventListener('click', () => safe(() => this.quickMarkPeriod()));
    document.getElementById('btn-qp-gone').addEventListener('click', () => safe(() => this.confirmPeriodEnd()));
    document.getElementById('btn-qp-still').addEventListener('click', () => safe(() => this.dismissOngoing()));
    document.getElementById('btn-qp-cancel').addEventListener('click', () => safe(() => this.quickCancelPeriod()));

    // Detail modal (mini log)
    document.getElementById('btn-dp-save').addEventListener('click', () => safe(() => this.saveDetail()));
    document.getElementById('btn-dp-cancel').addEventListener('click', () => safe(() => {
      document.getElementById('detail-modal').classList.add('hidden');
    }));
    // Pain slider display
    document.getElementById('dp-pain').addEventListener('input', function() {
      document.getElementById('dp-pain-display').textContent = this.value + ' 级';
    });
    // Flow toggle in detail modal
    document.querySelectorAll('#dp-flow .opt-btn').forEach(b => {
      b.addEventListener('click', function() {
        document.querySelectorAll('#dp-flow .opt-btn').forEach(x => x.classList.remove('active'));
        this.classList.add('active');
      });
    });
    // Mood toggle
    document.querySelectorAll('#dp-mood .mood-btn').forEach(b => {
      b.addEventListener('click', function() {
        document.querySelectorAll('#dp-mood .mood-btn').forEach(x => x.classList.remove('active'));
        this.classList.add('active');
      });
    });

    // Hide quick panel on any background click
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('quick-panel');
      if (!panel || panel.classList.contains('hidden')) return;
      if (!e.target.closest('#quick-panel') && !e.target.closest('.cal-day')) {
        panel.classList.add('hidden');
      }
    });

    // Server URL
    document.getElementById('btn-server-save').addEventListener('click', () => safe(() => this.saveServerUrl()));

    // Health Q&A
    document.getElementById('btn-qa-send').addEventListener('click', () => safe(() => this.askHealthQuestion()));
    document.getElementById('qa-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') safe(() => this.askHealthQuestion());
    });
  },

  // Local date helpers (avoid timezone bugs)
  _localDate(dateStr) {
    const p = dateStr.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  },
  _localToday() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  },
  _fmt(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  },
  _dayDiff(a, b) {
    return Math.round((a - b) / 86400000);
  },

  // Photo helpers
  _displayMealPhoto(dataUrl) {
    const preview = document.getElementById('meal-photo-preview');
    const img = document.getElementById('meal-photo-img');
    if (dataUrl) {
      img.src = dataUrl;
      preview.classList.remove('hidden');
    } else {
      preview.classList.add('hidden');
    }
  },

  _compressImage(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 800, maxH = 800;
        let w = img.width, h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio); h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        callback(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => callback(null);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  },

  // ====== Calendar ======
  renderCalendar() {
    const container = document.getElementById('calendar-container');
    const year = this.state.currentMonth.getFullYear();
    const month = this.state.currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - ((firstDay.getDay() + 6) % 7));
    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - (lastDay.getDay() + 6) % 7));

    // Build period sets
    const periodSet = new Set();
    const ongoingDaySet = new Set();
    const todayDate = this._localToday();
    const todayStr = this._fmt(todayDate);

    this.state.records.forEach(r => {
      if (!r.endDate) {
        // Ongoing: mark the start date + any confirmed ongoing dates
        const ds = this._fmt(this._localDate(r.startDate));
        periodSet.add(ds);
        ongoingDaySet.add(ds);
        if (r.ongoingDates) {
          r.ongoingDates.forEach(d => {
            periodSet.add(d);
            ongoingDaySet.add(d);
          });
        }
      } else {
        const s = this._localDate(r.startDate);
        const e = this._localDate(r.endDate);
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
          periodSet.add(this._fmt(d));
        }
      }
    });

    // Phase markers for every completed cycle (capped at standard cycle length)
    const completed = [...this.state.records].filter(r => r.endDate).sort((a,b) => a.startDate.localeCompare(b.startDate));

    // Standard cycle length = first observed cycle
    const byStart = [...this.state.records].sort((a,b) => a.startDate.localeCompare(b.startDate));
    let stdCycle = 28;
    if (byStart.length >= 2) {
      const firstDiff = this._dayDiff(this._localDate(byStart[1].startDate), this._localDate(byStart[0].startDate));
      if (firstDiff >= 21 && firstDiff <= 45) stdCycle = firstDiff;
    }

    const phaseMap = {};
    completed.forEach((r, idx) => {
      const cycleStart = this._localDate(r.startDate);
      const pEnd = this._localDate(r.endDate);
      const nextReal = idx < completed.length - 1 ? this._localDate(completed[idx+1].startDate) : null;
      // Cap at standard cycle length — no phases in gap months
      const maxExpected = new Date(cycleStart.getTime() + stdCycle * 86400000);
      const nextStart = nextReal && nextReal <= maxExpected ? nextReal : maxExpected;

      const ovDay = Math.max(stdCycle - 14, 14);

      for (let d = new Date(pEnd); d < nextStart; d.setDate(d.getDate() + 1)) {
        const ds = this._fmt(d);
        if (periodSet.has(ds)) continue;
        const cDay = this._dayDiff(d, cycleStart) + 1;
        if (cDay >= ovDay - 1 && cDay <= ovDay + 1) {
          phaseMap[ds] = 'phase-ovulation';
        } else if (cDay > ovDay + 1) {
          phaseMap[ds] = 'phase-luteal';
        } else {
          phaseMap[ds] = 'phase-follicular';
        }
      }
    });

    const weekDays = ['一','二','三','四','五','六','日'];

    // Timeline progress
    this.renderTimeline();

    let html = `<div class="cal-header">
      <button class="cal-nav-btn" onclick="APP.prevMonth()">◀</button>
      <span class="cal-month" onclick="APP.showYearMonthPicker()">${year}年${month+1}月</span>
      <button class="cal-nav-btn" onclick="APP.nextMonth()">▶</button>
    </div>
    <div class="cal-weekdays">${weekDays.map(d=>`<span>${d}</span>`).join('')}</div>
    <div class="cal-days">`;

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = this._fmt(d);
      const isOther = d.getMonth() !== month;
      const isToday = dateStr === todayStr;
      const isPeriod = periodSet.has(dateStr);
      const isOngoing = ongoingDaySet.has(dateStr);
      const classes = ['cal-day'];

      if (isOther) classes.push('other-month');
      if (isToday) classes.push('today');
      if (isPeriod || isOngoing) classes.push('phase-menstrual');

      // Phase marker for non-period days
      if (!isPeriod && !isOngoing) {
        const ph = phaseMap[dateStr];
        if (ph) classes.push(ph);
      }

      // Day content: number + dots for log/ovulation
      let dayContent = `${d.getDate()}`;
      let dots = '';
      // Check for symptom log (unified with 记录 tab)
      const symLog = this.state.symptoms.find(s => s.date === dateStr);
      if (symLog && symLog.flowLevel > 0) dots += '<span class="day-dot dot-period"></span>';
      else if (symLog && symLog.mood) dots += '<span class="day-dot dot-log"></span>';
      if (this.state.settings.showOvulation && pred && dateStr === this._fmt(pred.ovulationDate)) dots += '<span class="day-dot dot-ovulation"></span>';

      html += `<div class="${classes.join(' ')}" onclick="APP.showQuickPanel('${dateStr}')">${dayContent}${dots ? `<span class="day-dots">${dots}</span>` : ''}</div>`;
    }

    html += `</div>
      <div class="cal-legend">
        <span><span class="leg-dot leg-menstrual"></span> 经期</span>
        <span><span class="leg-dot leg-follicular"></span> 卵泡期</span>
        <span><span class="leg-dot leg-ovulation"></span> 排卵期</span>
        <span><span class="leg-dot leg-luteal"></span> 黄体期</span>
        ${this.state.settings.showOvulation ? '<span><span class="leg-dot leg-ovulation" style="background:rgba(255,193,7,0.6);border:1px solid #FFB300"></span> 排卵日</span>' : ''}
        <span><span class="leg-dot" style="background:var(--text-light)"></span> 有记录</span>
      </div>`;

    container.innerHTML = html;
    this.renderAnalysisCards();
  },

  renderTimeline() {
    const bar = document.getElementById('timeline-bar');
    const label = document.getElementById('tl-label');
    const fill = document.getElementById('tl-fill');
    if (!bar) return;
    const sorted = [...this.state.records].sort((a,b) => b.startDate.localeCompare(a.startDate));
    if (sorted.length === 0) {
      label.textContent = '暂无周期数据';
      fill.style.width = '0%';
      return;
    }
    const recent = sorted[0];
    const start = this._localDate(recent.startDate);
    const today = this._localToday();
    const dayNum = this._dayDiff(today, start) + 1;
    const cycleLen = this.state.prediction ?
      this._dayDiff(this._localDate(this._fmt(this.state.prediction.nextPeriodStart)), start) :
      this.state.settings.typicalCycle;
    const pct = Math.min(100, Math.round((dayNum / Math.max(cycleLen, 1)) * 100));
    label.textContent = `周期第 ${Math.max(1, dayNum)} 天`;
    fill.style.width = `${pct}%`;
  },

  prevMonth() {
    const y = this.state.currentMonth.getFullYear();
    const m = this.state.currentMonth.getMonth();
    this.state.currentMonth = new Date(y, m - 1, 1);
    this.renderCalendar();
  },
  nextMonth() {
    const y = this.state.currentMonth.getFullYear();
    const m = this.state.currentMonth.getMonth();
    this.state.currentMonth = new Date(y, m + 1, 1);
    this.renderCalendar();
  },

  showYearMonthPicker() {
    const panel = document.getElementById('ym-picker');
    if (!panel) return;
    // Update active states
    panel.querySelectorAll('.ym-year-btn, .ym-month-btn').forEach(b => b.classList.remove('active'));
    const curYear = this.state.currentMonth.getFullYear();
    const curMonth = this.state.currentMonth.getMonth() + 1;
    const yb = panel.querySelector(`.ym-year-btn[data-year="${curYear}"]`);
    if (yb) { yb.classList.add('active'); yb.scrollIntoView({ block: 'center' }); }
    const mb = panel.querySelector(`.ym-month-btn[data-month="${curMonth}"]`);
    if (mb) { mb.classList.add('active'); mb.scrollIntoView({ block: 'center' }); }
    panel.classList.remove('hidden');
  },
  hideYearMonthPicker() {
    const panel = document.getElementById('ym-picker');
    if (panel) panel.classList.add('hidden');
  },
  selectYearMonth(year, month) {
    this.state.currentMonth = new Date(year, month - 1, 1);
    this.hideYearMonthPicker();
    this.renderCalendar();
  },

  initYearMonthPicker() {
    const picker = document.getElementById('ym-picker');
    if (!picker) return;
    const curYear = new Date().getFullYear();
    let html = '<div class="ym-picker-header"><span>选择年月</span><button class="ym-close" onclick="APP.hideYearMonthPicker()">✕</button></div>';
    html += '<div class="ym-body">';
    html += '<div class="ym-years">';
    for (let y = curYear - 8; y <= curYear + 2; y++) {
      html += `<button class="ym-year-btn" data-year="${y}">${y}年</button>`;
    }
    html += '</div>';
    html += '<div class="ym-months">';
    for (let m = 1; m <= 12; m++) {
      html += `<button class="ym-month-btn" data-month="${m}">${m}月</button>`;
    }
    html += '</div>';
    html += '</div>';
    picker.innerHTML = html;
    // Click handlers via delegation
    picker.addEventListener('click', (e) => {
      const btn = e.target.closest('.ym-year-btn, .ym-month-btn');
      if (!btn) return;
      if (btn.classList.contains('ym-year-btn')) {
        picker.querySelectorAll('.ym-year-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      } else {
        picker.querySelectorAll('.ym-month-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Auto-confirm when month is clicked
        const y = parseInt(picker.querySelector('.ym-year-btn.active')?.dataset?.year) || curYear;
        const m = parseInt(btn.dataset.month);
        this.selectYearMonth(y, m);
      }
    });
    // Set active
    const ys = this.state.currentMonth.getFullYear();
    const ms = this.state.currentMonth.getMonth() + 1;
    const yb = picker.querySelector(`.ym-year-btn[data-year="${ys}"]`);
    if (yb) yb.classList.add('active');
    const mb = picker.querySelector(`.ym-month-btn[data-month="${ms}"]`);
    if (mb) mb.classList.add('active');
  },

  // ====== Quick Action Panel ======
  showQuickPanel(dateStr) {
    this.state._qpDate = dateStr;
    const panel = document.getElementById('quick-panel');
    const isFuture = dateStr > this._fmt(this._localToday());
    // If the only match is an ongoing period that started ≥21 days ago,
    // treat it as no record so "月经来了" can be shown (new cycle)
    let record = this.state.records.find(r => {
      if (dateStr < r.startDate) return false;
      if (r.endDate) return dateStr <= r.endDate;
      return dateStr <= this._fmt(this._localToday());
    });
    if (record && !record.endDate) {
      const gap = this._dayDiff(this._localDate(dateStr), this._localDate(record.startDate));
      if (gap >= 21) record = undefined;
    }
    const noRecord = record === undefined;
    const isOngoing = record && !record.endDate;
    const isCompleted = record && !!record.endDate;
    document.getElementById('qp-date-label').textContent = dateStr + (isFuture ? '（未来日期）' : '') + (isOngoing ? ' 🔴 进行中' : '');

    // 月经来了按钮
    document.getElementById('btn-qp-period').style.display = (noRecord && !isFuture) ? '' : 'none';
    // 进行中询问组
    const og = document.getElementById('qp-ongoing-group');
    og.style.display = isOngoing ? '' : 'none';
    // 记录详情（所有非未来日期都可记录）
    document.getElementById('btn-qp-detail').style.display = isFuture ? 'none' : '';
    // 取消标记：有记录的日期均可取消（经期开始日→全部删除，经期内→保留之前）
    document.getElementById('btn-qp-cancel').style.display = (!noRecord && !isFuture) ? '' : 'none';

    panel.classList.remove('hidden');
  },

  dismissOngoing() {
    const dateStr = this.state._qpDate;
    if (!dateStr) return;
    const record = this.state.records.find(r => !r.endDate && dateStr >= r.startDate);
    if (record) {
      if (!record.ongoingDates) record.ongoingDates = [];
      // Fill all dates from start to confirmed date
      const start = this._localDate(record.startDate);
      const end = this._localDate(dateStr);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const ds = this._fmt(d);
        if (!record.ongoingDates.includes(ds)) record.ongoingDates.push(ds);
      }
      this.saveState();
      this.renderCalendar();
    }
    this.hideQuickPanel();
  },

  hideQuickPanel() {
    document.getElementById('quick-panel').classList.add('hidden');
  },

  quickMarkPeriod() {
    const dateStr = this.state._qpDate;
    if (!dateStr) return;
    // 禁止标记未来日期
    if (dateStr > this._fmt(this._localToday())) {
      this.showToast('不能标记未来的日期');
      return;
    }
    // 校验新周期门槛：距前后经期起始日至少21天
    const byStart = [...this.state.records].sort((a,b) => b.startDate.localeCompare(a.startDate));
    const lastRecord = byStart.find(r => r.startDate < dateStr);
    if (lastRecord) {
      const gap = this._dayDiff(this._localDate(dateStr), this._localDate(lastRecord.startDate));
      if (gap < 21) {
        this.showToast(`距上次经期起始日仅 ${gap} 天，不足21天，无法开启新周期`);
        return;
      }
    }
    const nextRecord = byStart.find(r => r.startDate > dateStr);
    if (nextRecord) {
      const gap = this._dayDiff(this._localDate(nextRecord.startDate), this._localDate(dateStr));
      if (gap < 21) {
        this.showToast(`距下次经期起始日仅 ${gap} 天，不足21天，无法开启新周期`);
        return;
      }
    }
    // 关闭上一个还在进行中的经期（结束日设为新周期前一天）
    const prevOngoing = this.state.records.find(r => !r.endDate && r.startDate < dateStr);
    if (prevOngoing) {
      const dayBefore = new Date(this._localDate(dateStr).getTime() - 86400000);
      prevOngoing.endDate = this._fmt(dayBefore);
      if (!prevOngoing.ongoingDates) prevOngoing.ongoingDates = [];
      const s = this._localDate(prevOngoing.startDate);
      const e = this._localDate(prevOngoing.endDate);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const ds = this._fmt(d);
        if (!prevOngoing.ongoingDates.includes(ds)) prevOngoing.ongoingDates.push(ds);
      }
    }
    // 创建进行中的经期记录（无 endDate）
    this.state.records.push({ id: Date.now(), startDate: dateStr, endDate: null, notes: '' });
    this.state.records.sort((a,b) => b.startDate.localeCompare(a.startDate));
    this.saveState();
    this.computePrediction();
    this.computeStats();
    this.renderCalendar();
    this.updatePhaseBanner();
    this.hideQuickPanel();
    this.showToast('月经已标记为进行中');
  },

  confirmPeriodEnd() {
    // Called when user clicks "月经走了"
    const dateStr = this.state._qpDate;
    if (!dateStr) return;
    const record = this.state.records.find(r => {
      if (dateStr < r.startDate) return false;
      if (r.endDate) return dateStr <= r.endDate;
      return dateStr <= this._fmt(this._localToday());
    });
    if (!record || record.endDate) return;
    record.endDate = dateStr;
    // Fill ongoingDates for the entire period span
    if (!record.ongoingDates) record.ongoingDates = [];
    const s = this._localDate(record.startDate);
    const e = this._localDate(dateStr);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const ds = this._fmt(d);
      if (!record.ongoingDates.includes(ds)) record.ongoingDates.push(ds);
    }
    this.saveState();
    this.computePrediction();
    this.computeStats();
    this.renderCalendar();
    this.updatePhaseBanner();
    this.hideQuickPanel();
    this.showToast(`月经在 ${dateStr} 结束了`);
  },

  quickEndPeriod() {
    const dateStr = this.state._qpDate;
    if (!dateStr) return;
    const record = this.state.records.find(r => {
      if (dateStr < r.startDate) return false;
      if (r.endDate) return dateStr <= r.endDate;
      return dateStr <= this._fmt(this._localToday());
    });
    if (!record || record.endDate) return;
    record.endDate = dateStr;
    if (!record.ongoingDates) record.ongoingDates = [];
    const s = this._localDate(record.startDate);
    const e = this._localDate(dateStr);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const ds = this._fmt(d);
      if (!record.ongoingDates.includes(ds)) record.ongoingDates.push(ds);
    }
    this.saveState();
    this.computePrediction();
    this.computeStats();
    this.renderCalendar();
    this.updatePhaseBanner();
    this.hideQuickPanel();
    this.showToast(`月经在 ${dateStr} 结束了`);
  },

  quickCancelPeriod() {
    const dateStr = this.state._qpDate;
    if (!dateStr) return;
    const record = this.state.records.find(r => {
      if (dateStr < r.startDate) return false;
      if (r.endDate) return dateStr <= r.endDate;
      return dateStr <= this._fmt(this._localToday());
    });
    if (!record) return;
    if (dateStr === record.startDate) {
      // 经期开始日取消 → 整条记录删除
      const idx = this.state.records.indexOf(record);
      if (idx !== -1) this.state.records.splice(idx, 1);
    } else {
      // 经期结束/经期中取消 → 取消标记的当日及之后移除，经期继续进行
      record.endDate = null;
      if (record.ongoingDates) {
        record.ongoingDates = record.ongoingDates.filter(d => d < dateStr);
      } else {
        record.ongoingDates = [];
      }
    }
    this.saveState();
    this.computePrediction();
    this.computeStats();
    this.renderCalendar();
    this.updatePhaseBanner();
    this.hideQuickPanel();
    this.showToast('已取消标记');
  },

  openDetailModal() {
    try {
      const dateStr = this.state._qpDate;
      if (!dateStr) return;
      this.hideQuickPanel();
      this.state._detailDate = dateStr;
      document.getElementById('detail-date-label').textContent = dateStr;
      // Load from unified symptoms array (same data as 记录 tab)
      let log = this.state.symptoms.find(s => s.date === dateStr);
      // Fallback: migrate old dailyLogs format
      if (!log && this.state.dailyLogs[dateStr]) {
        const old = this.state.dailyLogs[dateStr];
        log = {
          painLevel: old.pain != null ? Math.round(old.pain * 3.33) : 0,
          flowLevel: old.flow ?? 0,
          mood: 'calm',
          customTags: old.symptoms || [],
          note: old.note || '',
        };
      }
      const isEdit = !!log;
      document.getElementById('btn-dp-save').textContent = isEdit ? '修改' : '保存';
      // Pain
      document.getElementById('dp-pain').value = log ? log.painLevel || 0 : 0;
      document.getElementById('dp-pain-display').textContent = (log ? log.painLevel || 0 : 0) + ' 级';
      // Flow
      const flowVal = log ? log.flowLevel ?? 0 : 0;
      document.querySelectorAll('#dp-flow .opt-btn').forEach(b => b.classList.toggle('active', b.dataset.v == flowVal));
      // Mood
      const moodVal = log ? log.mood || 'calm' : 'calm';
      document.querySelectorAll('#dp-mood .mood-btn').forEach(b => b.classList.toggle('active', b.dataset.v === moodVal));
      // Tags
      this._renderDetailTags(log ? log.customTags || [] : []);
      // Note
      document.getElementById('dp-note').value = log ? log.note || '' : '';
      document.getElementById('detail-modal').classList.remove('hidden');
    } catch(e) { this.showToast('打开失败: ' + e.message); }
  },

  _renderDetailTags(activeTags) {
    const container = document.getElementById('dp-tags');
    if (this.state.tags.length === 0) {
      container.innerHTML = '<span style="font-size:12px;color:#999">暂无标签</span>';
      return;
    }
    container.innerHTML = this.state.tags.map(t =>
      `<button class="tag-btn ${activeTags.includes(t) ? 'active' : ''}" data-tag="${t}">${t}</button>`
    ).join('');
    container.querySelectorAll('.tag-btn').forEach(btn => {
      btn.onclick = () => btn.classList.toggle('active');
    });
  },

  saveDetail() {
    const dateStr = this.state._detailDate;
    if (!dateStr) return;
    const painLevel = parseInt(document.getElementById('dp-pain').value) || 0;
    const flowLevel = parseInt(document.querySelector('#dp-flow .opt-btn.active')?.dataset?.v) || 0;
    const mood = document.querySelector('#dp-mood .mood-btn.active')?.dataset?.v || 'calm';
    const tags = [...document.querySelectorAll('#dp-tags .tag-btn.active')].map(b => b.dataset.tag);
    const note = document.getElementById('dp-note').value;
    // Save to unified symptoms array (same data as 记录 tab)
    const existing = this.state.symptoms.find(s => s.date === dateStr);
    if (existing) {
      Object.assign(existing, { painLevel, flowLevel, mood, customTags: tags, note });
    } else {
      this.state.symptoms.push({ id: Date.now(), date: dateStr, painLevel, flowLevel, mood, customTags: tags, note });
    }
    this.saveState();
    this.renderCalendar();
    document.getElementById('detail-modal').classList.add('hidden');
    this.showToast(existing ? '记录已修改' : '记录已保存');
  },

  // ====== Analysis Cards ======
  renderAnalysisCards() {
    const container = document.getElementById('analysis-cards');
    if (!container) return;
    const sorted = [...this.state.records].sort((a,b) => b.startDate.localeCompare(a.startDate));
    if (sorted.length === 0) { container.innerHTML = ''; return; }

    const recent = sorted[0];
    const year = this.state.currentMonth.getFullYear();
    const month = this.state.currentMonth.getMonth();

    // Current month period info
    const monthRecords = sorted.filter(r => r.startDate >= `${year}-${String(month+1).padStart(2,'0')}-01`);
    const monthPeriod = monthRecords.length > 0 ? monthRecords[0] : null;
    let periodDays = 0;
    if (monthPeriod && monthPeriod.endDate) {
      periodDays = this._dayDiff(this._localDate(monthPeriod.endDate), this._localDate(monthPeriod.startDate)) + 1;
    }

    // Symptoms this month (from unified symptoms array)
    const monthStart = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const monthEnd = this._fmt(new Date(year, month + 1, 0));
    const symptomCount = {};
    this.state.symptoms.forEach(s => {
      if (s.date < monthStart || s.date > monthEnd) return;
      if (s.customTags) s.customTags.forEach(t => { symptomCount[t] = (symptomCount[t] || 0) + 1; });
    });
    const topSymptoms = Object.entries(symptomCount).sort((a,b) => b[1] - a[1]).slice(0, 3);

    // Mood stats (from symptoms array)
    const moodCount = {};
    this.state.symptoms.forEach(s => {
      if (s.date < monthStart || s.date > monthEnd) return;
      if (s.mood === 'emotional') moodCount['情绪波动'] = (moodCount['情绪波动'] || 0) + 1;
      if (s.mood === 'sad') moodCount['难过'] = (moodCount['难过'] || 0) + 1;
      if (s.mood === 'irritable') moodCount['易怒'] = (moodCount['易怒'] || 0) + 1;
    });

    const stats = this.state.stats;
    const pred = this.state.prediction;
    let html = '';

    // Card 1: Monthly summary
    if (monthPeriod) {
      html += `<div class="analysis-card"><h3>📊 本月概览</h3>
        <div class="ac-row"><span>经期开始</span><span>${monthPeriod.startDate}</span></div>
        ${monthPeriod.endDate ? `<div class="ac-row"><span>经期结束</span><span>${monthPeriod.endDate}</span></div>
        <div class="ac-row"><span>持续天数</span><span>${periodDays} 天</span></div>` : '<div class="ac-row"><span>状态</span><span style="color:var(--pink)">进行中</span></div>'}
      </div>`;
    }

    // Card 2: Cycle stability
    if (stats && stats.avgCycle > 0) {
      const prevCycle = stats.cycles && stats.cycles.length >= 2 ? stats.cycles[stats.cycles.length - 1] : stats.avgCycle;
      const diff = stats.avgCycle - prevCycle;
      const stabilityText = diff === 0 ? '与上次完全一致，非常规律' :
        diff > 0 ? `比上次推迟了 ${diff} 天，属于正常波动范围` :
        `比上次提前了 ${Math.abs(diff)} 天，属于正常波动范围`;
      html += `<div class="analysis-card"><h3>📈 周期稳定性</h3>
        <p>您的平均周期为 ${stats.avgCycle} 天，${stabilityText}。</p>
      </div>`;
    }

    // Card 3: Top symptoms
    if (topSymptoms.length > 0) {
      html += `<div class="analysis-card"><h3>🏷️ 本月症状统计</h3>
        <div class="ac-tags">${topSymptoms.map(([k,v]) => `<span class="ac-tag">${k} ${v}次</span>`).join('')}</div>
      </div>`;
    }

    // Card 4: Mood
    if (Object.keys(moodCount).length > 0) {
      html += `<div class="analysis-card"><h3>😊 情绪晴雨表</h3>
        <p>本月您有 ${moodCount['情绪波动']} 天记录了情绪波动，请多关注自己的心情变化 🌸</p>
      </div>`;
    }

    if (!html) html = '<div class="analysis-empty">暂无本月数据，记录后自动生成分析</div>';
    container.innerHTML = html;
  },

  // ====== Phase Banner ======
  updatePhaseBanner() {
    const banner = document.getElementById('phase-banner');
    const pred = this.state.prediction;
    const hasRecords = this.state.records.length > 0;

    if (!hasRecords) {
      banner.classList.add('hidden');
      document.getElementById('header-subtitle').textContent = '点击日历日期，添加实际经期记录';
      return;
    }

    const phases = {
      menstrual: {icon:'🩸', title:'经期', tip:'注意保暖，多喝红糖姜茶，避免生冷食物'},
      follicular: {icon:'🌱', title:'卵泡期', tip:'精力回升，适合轻度运动和有氧活动'},
      ovulation: {icon:'🥚', title:'排卵期', tip:'身体状态最佳，注意休息和营养补充'},
      luteal: {icon:'🌙', title:'黄体期', tip:'可能出现情绪波动，建议多摄入富含维生素B的食物'},
    };
    const phase = phases[pred?.currentPhase || 'luteal'] || phases.luteal;
    document.getElementById('phase-icon').textContent = phase.icon;
    document.getElementById('phase-title').textContent = phase.title;
    document.getElementById('phase-tip').textContent = phase.tip;
    banner.classList.remove('hidden');

    if (!pred) {
      document.getElementById('header-subtitle').textContent = '继续添加经期记录，预测会更准确';
      return;
    }

    // Check if currently in an ongoing period
    const ongoing = this.state.records.some(r => !r.endDate);
    if (ongoing) {
      document.getElementById('header-subtitle').textContent = '经期进行中，结束后记得标记 ✓';
      return;
    }
    document.getElementById('header-subtitle').textContent =
      pred.daysUntilNextPeriod === 0 ? '今天可能来，注意做好准备' :
      `距离下次经期还有 ${pred.daysUntilNextPeriod} 天`;
  },

  // ====== Cycle Prediction Algorithm ======
  computePrediction() {
    const sorted = [...this.state.records].sort((a,b) => b.startDate.localeCompare(a.startDate));
    const today = this._localToday();

    if (sorted.length === 0) {
      const next = new Date(today); next.setDate(next.getDate() + 28);
      this.state.prediction = {
        nextPeriodStart: next,
        nextPeriodEnd: new Date(next.getTime() + 4*86400000),
        ovulationDate: new Date(next.getTime() + 14*86400000),
        currentPhase: 'luteal',
        daysUntilNextPeriod: 28,
        confidence: 0,
      };
      return;
    }

    let avgCycle = 28;
    if (sorted.length >= 2) {
      const cycles = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        const diff = this._dayDiff(this._localDate(sorted[i].startDate), this._localDate(sorted[i+1].startDate));
        if (diff >= 21 && diff <= 45) cycles.push(diff);
      }
      if (cycles.length > 0) avgCycle = Math.round(cycles.reduce((a,b)=>a+b,0) / cycles.length);
    }

    let avgPeriod = 5;
    const periodLengths = sorted.filter(r => r.endDate).map(r =>
      this._dayDiff(this._localDate(r.endDate), this._localDate(r.startDate)) + 1
    ).filter(l => l >= 2 && l <= 10);
    if (periodLengths.length > 0) avgPeriod = Math.round(periodLengths.reduce((a,b)=>a+b,0) / periodLengths.length);

    // Standard cycle length = first observed cycle
    const byStart = [...this.state.records].sort((a,b) => a.startDate.localeCompare(b.startDate));
    let stdCycle = 28;
    if (byStart.length >= 2) {
      const firstDiff = this._dayDiff(this._localDate(byStart[1].startDate), this._localDate(byStart[0].startDate));
      if (firstDiff >= 21 && firstDiff <= 45) stdCycle = firstDiff;
    }

    const lastStart = this._localDate(sorted[0].startDate);
    const predictedStart = new Date(lastStart);
    predictedStart.setDate(predictedStart.getDate() + stdCycle);
    const predictedEnd = new Date(predictedStart);
    predictedEnd.setDate(predictedEnd.getDate() + avgPeriod - 1);
    const ovulationDate = new Date(predictedStart);
    ovulationDate.setDate(ovulationDate.getDate() + 14);

    const daysUntil = Math.max(0, this._dayDiff(predictedStart, today));

    let currentPhase = 'luteal';
    const complRecords = this.state.records.filter(r => r.endDate).sort((a,b) => a.startDate.localeCompare(b.startDate));
    if (complRecords.length > 0) {
      const last = complRecords[complRecords.length - 1];
      const cycleStart = this._localDate(last.startDate);
      const pEnd = this._localDate(last.endDate);
      const nextRecord = this.state.records.find(r => this._localDate(r.startDate) > cycleStart);
      const nextReal = nextRecord ? this._localDate(nextRecord.startDate) : null;
      const maxExpected = new Date(cycleStart.getTime() + stdCycle * 86400000);
      const nextStart = nextReal && nextReal <= maxExpected ? nextReal : maxExpected;
      const cDay = this._dayDiff(today, cycleStart) + 1;
      const ovDay = Math.max(stdCycle - 14, 14);
      if (cDay <= this._dayDiff(pEnd, cycleStart) + 1) {
        currentPhase = 'menstrual';
      } else if (cDay >= ovDay - 1 && cDay <= ovDay + 1) {
        currentPhase = 'ovulation';
      } else if (cDay > ovDay + 1) {
        currentPhase = 'luteal';
      } else {
        currentPhase = 'follicular';
      }
    } else if (this.state.records.some(r => !r.endDate)) {
      currentPhase = 'menstrual';
    }

    const confidence = Math.min(sorted.length / 3, 1) * 0.9;

    this.state.prediction = {
      nextPeriodStart: predictedStart,
      nextPeriodEnd: predictedEnd,
      ovulationDate,
      fertileWindowStart: new Date(ovulationDate.getTime() - 3*86400000),
      fertileWindowEnd: new Date(ovulationDate.getTime() + 3*86400000),
      currentPhase,
      daysUntilNextPeriod: daysUntil,
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  },

  computeStats() {
    const sorted = [...this.state.records].sort((a,b) => a.startDate.localeCompare(b.startDate));
    const cycles = [];
    for (let i = 1; i < sorted.length; i++) {
      const diff = this._dayDiff(this._localDate(sorted[i].startDate), this._localDate(sorted[i-1].startDate));
      if (diff >= 21 && diff <= 45) cycles.push(diff);
    }

    const periods = sorted.map(r => {
      if (!r.endDate) return 0;
      return this._dayDiff(this._localDate(r.endDate), this._localDate(r.startDate)) + 1;
    }).filter(l => l >= 2 && l <= 10);

    const hasData = sorted.length > 0;
    const avgCycle = cycles.length > 0 ? Math.round(cycles.reduce((a,b)=>a+b,0)/cycles.length) : 0;
    const avgPeriod = periods.length > 0 ? Math.round(periods.reduce((a,b)=>a+b,0)/periods.length) : 0;

    this.state.stats = { avgCycle, avgPeriod, cycles: cycles.slice(-6) };

    document.getElementById('stat-cycle').textContent = hasData && avgCycle > 0 ? avgCycle : '--';
    document.getElementById('stat-period').textContent = hasData && avgPeriod > 0 ? avgPeriod : '--';
    document.getElementById('stat-confidence').textContent =
      this.state.prediction ? Math.round(this.state.prediction.confidence * 100) + '%' : '--';
  },

  // ====== Symptom Log ======
  renderLog() {
    const phaseHint = document.getElementById('log-phase-hint');
    const pred = this.state.prediction;
    const phases = ['经期','卵泡期','排卵期','黄体期'];
    const idx = ['menstrual','follicular','ovulation','luteal'].indexOf(pred?.currentPhase || 'luteal');
    phaseHint.textContent = `当前处于${phases[idx]}，记录症状帮助预测更准确`;
    phaseHint.classList.remove('hidden');
    // Load today's existing data from symptoms (unified with detail modal)
    const todayStr = this._fmt(this._localToday());
    const existing = this.state.symptoms.find(s => s.date === todayStr);
    // Mood
    const moodVal = existing ? existing.mood : this.state.selectedMood;
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mood-btn[data-mood="' + moodVal + '"]').forEach(b => b.classList.add('active'));
    // Flow
    const flowVal = existing ? existing.flowLevel ?? 0 : this.state.selectedFlow;
    document.querySelectorAll('#flow-group .opt-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#flow-group .opt-btn[data-value="' + flowVal + '"]').forEach(b => b.classList.add('active'));
    // Pain
    const painVal = existing ? existing.painLevel || 0 : 0;
    document.getElementById('pain-level').value = painVal;
    document.getElementById('pain-display').textContent = painVal + ' 级';
    // Tags
    if (existing && existing.customTags) {
      document.querySelectorAll('#tag-group .tag-btn').forEach(b => {
        b.classList.toggle('active', existing.customTags.includes(b.dataset.tag));
      });
    } else {
      document.querySelectorAll('#tag-group .tag-btn').forEach(b => b.classList.remove('active'));
    }
    // Note
    document.getElementById('log-note').value = existing ? existing.note || '' : '';
    document.getElementById('btn-save-log').textContent = existing ? '修改记录' : '保存记录';
  },

  renderTags() {
    const container = document.getElementById('tag-group');
    container.innerHTML = this.state.tags.map(t =>
      `<button class="tag-btn" data-tag="${t}">${t}</button>`
    ).join('');

    container.querySelectorAll('.tag-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        const tag = btn.dataset.tag;
        if (this.state.selectedTags.includes(tag))
          this.state.selectedTags = this.state.selectedTags.filter(t => t !== tag);
        else
          this.state.selectedTags.push(tag);
      });
    });
  },

  saveLog() {
    const todayStr = this._fmt(this._localToday());
    const painLevel = parseInt(document.getElementById('pain-level').value);
    const flowLevel = this.state.selectedFlow;
    const mood = this.state.selectedMood;
    const customTags = [...this.state.selectedTags];
    const note = document.getElementById('log-note').value;
    // Update existing entry or create new (unified with detail modal)
    const existing = this.state.symptoms.find(s => s.date === todayStr);
    if (existing) {
      Object.assign(existing, { painLevel, flowLevel, mood, customTags, note });
    } else {
      this.state.symptoms.push({ id: Date.now(), date: todayStr, painLevel, flowLevel, mood, customTags, note });
    }
    this.saveState();
    this.showToast('记录成功，照顾好自己 💕');

    document.getElementById('pain-level').value = 0;
    document.getElementById('pain-display').textContent = '0 级';
    this.state.selectedFlow = 0;
    document.querySelectorAll('#flow-group .opt-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#flow-group .opt-btn:first-child').forEach(b => b.classList.add('active'));
    this.state.selectedMood = 'calm';
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mood-btn[data-mood="calm"]').forEach(b => b.classList.add('active'));
    this.state.selectedTags = [];
    document.querySelectorAll('.tag-group .tag-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('log-note').value = '';
  },

  // ====== Meals / Diet ======
  renderDiet() {
    this.renderDietPhaseCard();
    this.renderDietRecommend();
    this.renderMeals();
  },

  renderDietPhaseCard() {
    const card = document.getElementById('diet-phase-card');
    const hasRecords = this.state.records.length > 0;
    const pred = this.state.prediction;

    if (!hasRecords) {
      card.innerHTML = `
        <div class="dpc-icon">🌸</div>
        <div class="dpc-title">欢迎使用饮食建议</div>
        <div class="dpc-sub">先在日历中记录经期，饮食建议会根据周期阶段自动调整</div>
      `;
      card.className = 'diet-phase-card';
      card.style.background = 'linear-gradient(135deg,var(--pink),#FF8FA3)';
      return;
    }

    const phase = pred?.currentPhase || 'luteal';

    const phaseData = {
      menstrual: {
        icon: '🩸', title: '经期', sub: '第1~5天 · 温暖补血为主',
        do: [['红枣','补气血'],['桂圆','暖身'],['红糖姜茶','驱寒暖宫'],['黑巧克力','缓解情绪'],['温牛奶','助眠安神'],['菠菜','补铁'],['动物肝脏','补铁补血'],['深海鱼','Omega-3消炎']],
        dont: ['冰淇淋、冷饮','辛辣刺激食物','咖啡、浓茶','酒精类饮品','高盐食物（易水肿）'],
        tip: '经期身体流失铁质，多吃补铁食物，注意保暖。避免生冷和刺激性食物，多喝温水。'
      },
      follicular: {
        icon: '🌱', title: '卵泡期', sub: '第6~12天 · 滋补养卵',
        do: [['豆制品（豆浆/豆腐）','补充雌激素'],['鸡蛋','优质蛋白'],['瘦肉','补铁补蛋白'],['绿叶蔬菜','维生素'],['坚果','健康脂肪'],['水果','维生素C'],['全谷物','膳食纤维']],
        dont: ['过度油腻食物','高糖分加工食品'],
        tip: '卵泡期是身体状态回升期，多补充优质蛋白和维生素，为排卵做准备。'
      },
      ovulation: {
        icon: '🥚', title: '排卵期', sub: '第13~16天 · 抗氧养护',
        do: [['西兰花','抗氧化'],['芦笋','叶酸丰富'],['牛油果','健康脂肪'],['橄榄油','抗炎'],['莓果（蓝莓/草莓）','抗氧化'],['深海鱼','Omega-3'],['亚麻籽','植物雌激素']],
        dont: ['高糖食物','过度加工碳水化合物','油炸食品'],
        tip: '排卵期身体代谢旺盛，多摄入抗氧化物和健康脂肪，帮助卵子质量提升。'
      },
      luteal: {
        icon: '🌙', title: '黄体期', sub: '第17~28天 · 舒缓平衡',
        do: [['香蕉','补钾缓解浮肿'],['坚果（杏仁/核桃）','稳定情绪'],['全麦食品','B族维生素'],['深绿色蔬菜','补镁'],['豆类','膳食纤维'],['酸奶','益生菌'],['燕麦','稳血糖']],
        dont: ['高盐零食（易水肿）','咖啡因（加重焦虑）','甜食（血糖波动）','红肉（促炎）','乳制品（若敏感）'],
        tip: '黄体期容易出现情绪波动和水肿，多吃富含B族维生素和镁的食物，减少盐分和咖啡因摄入。'
      },
    };

    const data = phaseData[phase] || phaseData.luteal;
    card.className = 'diet-phase-card ' + phase;
    card.style.background = '';

    card.innerHTML = `
      <span class="dpc-icon">${data.icon}</span>
      <span class="dpc-title">${data.title}期饮食指南</span>
      <span class="dpc-sub">${data.sub}</span>
      <div class="dpc-grid">
        <div class="dpc-col">
          <h4>✅ 推荐吃</h4>
          <ul>${data.do.map(f => `<li>${f[0]} — ${f[1]}</li>`).join('')}</ul>
        </div>
        <div class="dpc-col" style="background:rgba(255,255,255,0.15)">
          <h4>❌ 少吃/不吃</h4>
          <ul>${data.dont.map(f => `<li>${f}</li>`).join('')}</ul>
        </div>
      </div>
      <div class="dpc-tip">💡 ${data.tip}</div>
    `;
  },

  renderDietRecommend() {
    const el = document.getElementById('diet-recommend');
    const hasRecords = this.state.records.length > 0;
    if (!hasRecords) {
      el.innerHTML = '<div class="dr-empty">🌸 记录经期后，这里会显示对应的饮食建议</div>';
      return;
    }
    const pred = this.state.prediction;
    const phase = pred?.currentPhase || 'luteal';

    const allFoods = {
      menstrual: {
        do: [['红枣','🫘'],['桂圆','🍈'],['红糖姜茶','🫖'],['黑巧克力','🍫'],['温牛奶','🥛'],['菠菜','🥬'],['动物肝脏','🥩'],['深海鱼','🐟']],
        dont: ['🍦 冰淇淋、冷饮','🌶️ 辛辣刺激','☕ 咖啡、浓茶','🍺 酒精','🧂 高盐食物'],
      },
      follicular: {
        do: [['豆浆','🥛'],['鸡蛋','🥚'],['瘦肉','🥩'],['绿叶蔬菜','🥬'],['坚果','🥜'],['水果','🍎'],['全谷物','🌾']],
        dont: ['🍟 过度油腻','🍩 高糖加工食品'],
      },
      ovulation: {
        do: [['西兰花','🥦'],['芦笋','🌿'],['牛油果','🥑'],['橄榄油','🫒'],['莓果','🫐'],['深海鱼','🐟'],['亚麻籽','🌰']],
        dont: ['🍰 高糖食物','🍕 过度加工','🍟 油炸食品'],
      },
      luteal: {
        do: [['香蕉','🍌'],['坚果','🥜'],['全麦食品','🍞'],['深绿色蔬菜','🥬'],['豆类','🫘'],['酸奶','🥛'],['燕麦','🌾']],
        dont: ['🧂 高盐零食','☕ 咖啡因','🍬 甜食','🥩 红肉','🧀 乳制品'],
      },
    };

    const foods = allFoods[phase] || allFoods.luteal;
    const phaseNames = { menstrual:'经期', follicular:'卵泡期', ovulation:'排卵期', luteal:'黄体期' };

    el.innerHTML = `
      <div class="dr-section">
        <h3>✅ ${phaseNames[phase]}期推荐食材</h3>
        <div class="dr-food-list">
          ${foods.do.map(f => `<span class="dr-food-item"><span class="dr-food-emoji">${f[1]}</span>${f[0]}</span>`).join('')}
        </div>
      </div>
      <div class="dr-section">
        <h3>❌ ${phaseNames[phase]}期避免食用</h3>
        <div class="dr-avoid-list">
          ${foods.dont.map(f => `<span class="dr-avoid-item"><span class="dr-avoid-emoji">🚫</span>${f}</span>`).join('')}
        </div>
      </div>
    `;
  },

  renderMeals() {
    const container = document.getElementById('diet-list');
    let meals = [...this.state.meals];
    if (this.state.dietFilter !== 'all') {
      meals = meals.filter(m => m.type === this.state.dietFilter);
    }
    meals.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const typeLabels = { breakfast:'🥐 早餐', lunch:'🍛 午餐', dinner:'🍝 晚餐', snack:'🍪 加餐' };
    if (meals.length === 0) {
      container.innerHTML = '<div class="diet-empty">暂无饮食记录<br>点击上方「记录今日饮食」开始记录</div>';
      return;
    }
    container.innerHTML = meals.map(m => `
      <div class="diet-item" onclick="APP.openMealModal('${m.id}')">
        <div class="diet-item-header">
          <span class="diet-item-type">${typeLabels[m.type]||m.type}</span>
          <span class="diet-item-date">${m.date}</span>
        </div>
        <div class="diet-item-content">${this.escapeHtml(m.content)}</div>
        ${m.photo ? `<img src="${m.photo}" class="diet-item-photo" alt="食物照片">` : ''}
        ${m.tags&&m.tags.length ? '<div class="diet-item-tags">'+m.tags.map(t=>'<span class="diet-item-tag">'+t+'</span>').join('')+'</div>' : ''}
        ${m.note ? '<div class="diet-item-note">💬 '+this.escapeHtml(m.note)+'</div>' : ''}
      </div>
    `).join('');
  },

  openMealModal(id) {
    const modal = document.getElementById('meal-modal');
    const title = document.getElementById('meal-modal-title');
    const deleteBtn = document.getElementById('btn-meal-delete');
    // Reset photo state
    this._pendingMealPhoto = null;
    document.getElementById('meal-photo-preview').classList.add('hidden');
    document.getElementById('meal-photo-name').textContent = '';
    document.getElementById('meal-photo').value = '';
    if (id) {
      const meal = this.state.meals.find(m => m.id == id);
      if (!meal) return;
      this.state.editMealId = meal.id;
      title.textContent = '编辑饮食记录';
      document.getElementById('meal-type').value = meal.type;
      document.getElementById('meal-date').value = meal.date;
      document.getElementById('meal-content').value = meal.content;
      document.getElementById('meal-note').value = meal.note || '';
      this._displayMealPhoto(meal.photo);
      this.state.selectedMealTags = [...(meal.tags||[])];
      document.querySelectorAll('#meal-tags .tag-btn').forEach(b =>
        b.classList.toggle('active', this.state.selectedMealTags.includes(b.dataset.tag)));
      deleteBtn.style.display = 'block';
    } else {
      this.state.editMealId = null;
      title.textContent = '添加饮食记录';
      document.getElementById('meal-type').value = 'breakfast';
      document.getElementById('meal-date').value = this._fmt(this._localToday());
      document.getElementById('meal-content').value = '';
      document.getElementById('meal-note').value = '';
      this.state.selectedMealTags = [];
      document.querySelectorAll('#meal-tags .tag-btn').forEach(b => b.classList.remove('active'));
      deleteBtn.style.display = 'none';
    }
    modal.classList.remove('hidden');
  },

  closeMealModal() {
    document.getElementById('meal-modal').classList.add('hidden');
    this.state.editMealId = null;
    this._pendingMealPhoto = null;
  },

  saveMeal() {
    const type = document.getElementById('meal-type').value;
    const date = document.getElementById('meal-date').value;
    const content = document.getElementById('meal-content').value.trim();
    const note = document.getElementById('meal-note').value.trim();
    const tags = [...this.state.selectedMealTags];
    const photo = this._pendingMealPhoto || null;
    if (!content && !note && tags.length === 0 && !photo) { this.showToast('请至少填写一项内容'); return; }
    if (this.state.editMealId) {
      const idx = this.state.meals.findIndex(m => m.id === this.state.editMealId);
      if (idx !== -1) { this.state.meals[idx] = {...this.state.meals[idx], type, date, content, note, tags, photo}; }
    } else {
      this.state.meals.push({ id: Date.now(), type, date, content, note, tags, photo });
    }
    this._pendingMealPhoto = null;
    this.saveState();
    this.renderMeals();
    this.closeMealModal();
    this.showToast('饮食记录已保存');
  },

  deleteMeal() {
    if (!this.state.editMealId) return;
    if (!confirm('确定删除这条饮食记录吗？')) return;
    this.state.meals = this.state.meals.filter(m => m.id !== this.state.editMealId);
    this.saveState();
    this.renderMeals();
    this.closeMealModal();
    this.showToast('已删除');
  },

  // ====== Stats ======
  renderStats() {
    this.renderCycleChart();
    this.renderSymptomChart();
    this.renderPainChart();
    this.renderMoodDistribution();
  },

  renderFallbackChart(canvasId, title) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;
    parent.innerHTML = `<p style="text-align:center;color:#999;padding:30px 0">${title} - 数据已记录</p><p style="text-align:center;font-size:12px;color:#CCC">需要网络加载图表组件</p>`;
  },

  renderCycleChart() {
    if (typeof Chart === 'undefined') { this.renderFallbackChart('cycle-chart','周期趋势'); return; }
    if (!this.state.stats?.cycles?.length) {
      const parent = document.getElementById('cycle-chart')?.parentElement;
      if (parent) parent.innerHTML = '<p style="text-align:center;color:#999;padding:30px 0">暂无周期数据，记录经期后可查看趋势</p>';
      return;
    }
    const data = this.state.stats.cycles;
    const labels = data.map((_,i) => `第${i+1}次`);
    if (this._cycleChart) this._cycleChart.destroy();
    this._cycleChart = new Chart(document.getElementById('cycle-chart'), {
      type: 'line',
      data: { labels, datasets: [{
        label: '周期长度(天)',
        data,
        borderColor: '#FF6B8A',
        backgroundColor: 'rgba(255,107,138,0.1)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#FF6B8A',
        pointRadius: 4,
      }]},
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' } },
          x: { grid: { display: false } },
        },
      },
    });
  },

  renderSymptomChart() {
    if (typeof Chart === 'undefined') { this.renderFallbackChart('symptom-chart','症状频率'); return; }
    const freq = {};
    this.state.symptoms.forEach(s => s.customTags.forEach(t => { freq[t] = (freq[t]||0) + 1; }));
    const entries = Object.entries(freq).sort((a,b) => b[1] - a[1]).slice(0, 8);

    if (entries.length === 0) {
      document.getElementById('symptom-chart').parentElement.innerHTML +=
        '<p style="text-align:center;color:#CCC;padding:40px 0">记录症状后生成分析</p>';
      return;
    }

    if (this._sympChart) this._sympChart.destroy();
    this._sympChart = new Chart(document.getElementById('symptom-chart'), {
      type: 'bar',
      data: {
        labels: entries.map(([n]) => n.length > 4 ? n.slice(0,4)+'..' : n),
        datasets: [{
          label: '次数',
          data: entries.map(([,c]) => c),
          backgroundColor: 'rgba(255,107,138,0.7)',
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { stepSize: 1 } },
          x: { grid: { display: false } },
        },
      },
    });
  },

  renderPainChart() {
    if (typeof Chart === 'undefined') { this.renderFallbackChart('pain-chart','痛经趋势'); return; }
    const pains = this.state.symptoms.slice(-30).map(s => s.painLevel);
    if (pains.length < 2) { for(let i=pains.length;i<7;i++) pains.push(0); }

    if (this._painChart) this._painChart.destroy();
    this._painChart = new Chart(document.getElementById('pain-chart'), {
      type: 'line',
      data: {
        labels: pains.map((_,i) => `${i+1}`),
        datasets: [{
          label: '疼痛级别',
          data: pains,
          borderColor: '#FF6B8A',
          backgroundColor: 'rgba(255,107,138,0.1)',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#FF6B8A',
          pointRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, max: 10, grid: { color: 'rgba(0,0,0,0.05)' } },
          x: { grid: { display: false }, ticks: { maxTicksLimit: 7 } },
        },
      },
    });
  },

  renderMoodDistribution() {
    const container = document.getElementById('mood-distribution');
    const moodCounts = {};
    const moodLabels = { happy:'开心', sad:'难过', irritable:'易怒', anxious:'焦虑', calm:'平静', tired:'疲惫', emotional:'情绪化', energetic:'精力充沛' };
    this.state.symptoms.forEach(s => { moodCounts[s.mood] = (moodCounts[s.mood]||0) + 1; });

    const entries = Object.entries(moodCounts);
    if (entries.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:#CCC;padding:20px 0">记录心情后生成分布</p>';
      return;
    }

    const maxCount = Math.max(...entries.map(([,c]) => c));
    container.innerHTML = entries.map(([mood, count]) =>
      `<div class="mood-bar-item">
        <span class="mood-bar-label">${moodLabels[mood]||mood}</span>
        <div class="mood-bar-track">
          <div class="mood-bar-fill" style="width:${(count/maxCount)*100}%"></div>
        </div>
        <span class="mood-bar-count">${count}次</span>
      </div>`
    ).join('');
  },

  // ====== Partner ======
  renderPartner() {
    const user = this.state.auth.user;
    // If boy role, redirect to boyfriend dashboard
    if (user?.role === 'boy') {
      this.switchTab('boyfriend');
      return;
    }
    this.renderMamiMessages();
    const status = document.getElementById('partner-status');
    const pred = this.state.prediction;
    const phaseLabels = {
      menstrual: '🩸 经期 · 需要更多关爱',
      follicular: '🌱 卵泡期 · 精力回升',
      ovulation: '🥚 排卵期 · 状态最佳',
      luteal: '🌙 黄体期 · 情绪波动期',
    };

    status.innerHTML = `
      <span class="ps-icon">${pred?.currentPhase === 'menstrual' ? '🩸' : pred?.currentPhase === 'ovulation' ? '🥚' : pred?.currentPhase === 'luteal' ? '🌙' : '🌱'}</span>
      <span class="ps-title">${pred ? (phaseLabels[pred.currentPhase] || '暂无数据') : '暂无周期数据'}</span>
      <span class="ps-sub">${pred ? (pred.daysUntilNextPeriod === 0 ? '她可能正在经期，多关心她' : `距离下次经期还有 ${pred.daysUntilNextPeriod} 天`) : '记录数据后显示'}</span>
    `;

    const area = document.getElementById('partner-connect-area');
    const code = this.state.settings.partnerCode || this.state.auth.user?.bind_code || '';
    const enabled = this.state.settings.partnerSync;

    if (enabled) {
      area.innerHTML = `
        <p class="desc">已开启伴侣同步，你的绑定码：</p>
        <div class="code-box"><span>${code}</span></div>
        <button class="share-btn" onclick="APP.shareCode('${code}')">分享绑定码</button>
        <button class="btn-secondary" style="width:100%;margin-top:8px" onclick="APP.togglePartnerSync()">关闭同步</button>
      `;
    } else {
      area.innerHTML = `
        <p class="desc">开启后生成专属绑定码，TA绑定后可查看同步数据</p>
        <button class="btn-primary" style="width:100%;margin-top:8px" onclick="APP.enablePartnerSync()">开启伴侣同步</button>
      `;
    }
  },

  enablePartnerSync() {
    this.state.settings.partnerSync = true;
    this.saveState();
    this.renderPartner();
    this.showToast('绑定码已生成，分享给TA');
  },

  togglePartnerSync() {
    this.state.settings.partnerSync = !this.state.settings.partnerSync;
    this.saveState();
    this.renderPartner();
    this.showToast(this.state.settings.partnerSync ? '同步已开启' : '同步已关闭');
  },

  shareCode(code) {
    if (navigator.share) {
      navigator.share({ title: '乖宝生理期', text: `我的绑定码：${code}，快来绑定伴侣同步数据！` });
    } else {
      navigator.clipboard.writeText(code).then(() => this.showToast('绑定码已复制'));
    }
  },

  async sendMamiMessage() {
    const input = document.getElementById('mami-input');
    const text = input.value.trim();
    if (!text) { this.showToast('请输入内容'); return; }
    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
    this.state.partnerMessages.push({ text, time: timeStr, date: this._fmt(now), from: 'self' });
    this.saveState();
    input.value = '';
    this.renderMamiMessages();
    this.showToast('已发送');
    // Sync to server
    if (this.state.auth.token) {
      try {
        await fetch(API_BASE + '/api/partner-messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.state.auth.token },
          body: JSON.stringify({ message: text })
        });
      } catch(e) {}
    }
    const list = document.getElementById('mami-tips');
    if (list) list.scrollTop = 0;
  },

  shareCode() {
    const code = this.state.settings.partnerCode;
    if (navigator.share) {
      navigator.share({ title: '乖宝生理期伴侣同步', text: `我的邀请码：${code}，快来加入伴侣同步！` });
    } else {
      navigator.clipboard.writeText(code).then(() => this.showToast('邀请码已复制'));
    }
  },

  generateAiSuggestion() {
    const pred = this.state.prediction;
    if (!pred) { this.showToast('请先记录经期数据'); return; }

    const suggestions = {
      menstrual: '她正在经期，建议准备：暖宝宝、红糖姜茶、止痛药（布洛芬）。多帮她按摩腰部，让她好好休息。',
      follicular: '她处于卵泡期，精力回升中。这周可以约她散步、做轻度运动，心情会更好。',
      ovulation: '她处于排卵期，状态最佳。多陪陪她，安排一些有趣的活动一起享受。',
      luteal: '她处于黄体期，情绪可能波动。建议买杯奶茶或巧克力哄哄她，多点耐心和理解。',
    };

    const area = document.getElementById('ai-suggestion-area');
    const msg = suggestions[pred.currentPhase] || '多关心她最近的状态';
    area.innerHTML = `
      <div class="suggestion-box"><p>💝 ${msg}</p></div>
      <button class="btn-primary" onclick="APP.generateAiSuggestion()">重新生成</button>
    `;
    this.showToast('已生成行动建议 💕');
  },

  // ====== Boyfriend Dashboard ======
  renderBoyfriendDashboard() {
    const user = this.state.auth.user;
    if (!user || user.role !== 'boy') {
      document.querySelectorAll('#page-boyfriend .bf-authenticated').forEach(el => el.classList.add('hidden'));
      document.getElementById('bf-disconnected')?.classList.remove('hidden');
      return;
    }
    const bound = this.state.auth.boundUser;
    if (!bound) {
      document.querySelectorAll('#page-boyfriend .bf-authenticated').forEach(el => el.classList.add('hidden'));
      document.getElementById('bf-disconnected')?.classList.remove('hidden');
      return;
    }
    document.getElementById('bf-disconnected')?.classList.add('hidden');
    document.querySelectorAll('#page-boyfriend .bf-authenticated').forEach(el => el.classList.remove('hidden'));
    // Render calendar read-only
    this.renderBfCalendar();
    this.renderBfStats();
    this.renderBfAnalysis();
    this.renderBfMamiMessages();
    this.renderBfPhaseBanner();
  },

  renderBfPhaseBanner() {
    const banner = document.getElementById('bf-status');
    const pred = this.state.prediction;
    if (!pred) { banner.classList.add('hidden'); return; }
    const phases = {
      menstrual: {icon:'🩸', title:'经期', tip:'需要更多关爱和照顾'},
      follicular: {icon:'🌱', title:'卵泡期', tip:'精力回升，心情不错'},
      ovulation: {icon:'🥚', title:'排卵期', tip:'状态最佳'},
      luteal: {icon:'🌙', title:'黄体期', tip:'情绪可能波动，多些耐心'},
    };
    const phase = phases[pred.currentPhase] || phases.luteal;
    document.getElementById('bf-phase-icon').textContent = phase.icon;
    document.getElementById('bf-phase-title').textContent = phase.title;
    document.getElementById('bf-phase-tip').textContent = phase.tip;
    banner.classList.remove('hidden');
  },

  renderBfCalendar() {
    const container = document.getElementById('bf-calendar');
    // Use same logic as main calendar but read-only
    const year = this.state.currentMonth.getFullYear();
    const month = this.state.currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - ((firstDay.getDay() + 6) % 7));
    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - (lastDay.getDay() + 6) % 7));
    const periodSet = new Set();
    const todayStr = this._fmt(this._localToday());
    this.state.records.forEach(r => {
      if (!r.endDate) {
        const ds = this._fmt(this._localDate(r.startDate));
        periodSet.add(ds);
        if (r.ongoingDates) r.ongoingDates.forEach(d => periodSet.add(d));
      } else {
        const s = this._localDate(r.startDate);
        const e = this._localDate(r.endDate);
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) periodSet.add(this._fmt(d));
      }
    });
    const weekDays = ['一','二','三','四','五','六','日'];
    let html = `<div class="cal-header">
      <button class="cal-nav-btn" onclick="APP.prevMonth();APP.renderBoyfriendDashboard()">◀</button>
      <span class="cal-month">${year}年${month+1}月</span>
      <button class="cal-nav-btn" onclick="APP.nextMonth();APP.renderBoyfriendDashboard()">▶</button>
    </div>
    <div class="cal-weekdays">${weekDays.map(d=>`<span>${d}</span>`).join('')}</div>
    <div class="cal-days">`;
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = this._fmt(d);
      const isOther = d.getMonth() !== month;
      const isToday = dateStr === todayStr;
      const isPeriod = periodSet.has(dateStr);
      const classes = ['cal-day'];
      if (isOther) classes.push('other-month');
      if (isToday) classes.push('today');
      if (isPeriod) classes.push('phase-menstrual');
      html += `<div class="${classes.join(' ')}">${d.getDate()}</div>`;
    }
    html += `</div>
      <div class="cal-legend">
        <span><span class="leg-dot leg-menstrual"></span> 经期</span>
        <span><span class="leg-dot" style="background:var(--text-light)"></span> 其他</span>
      </div>`;
    container.innerHTML = html;
  },

  renderBfStats() {
    const sorted = [...this.state.records].sort((a,b) => a.startDate.localeCompare(b.startDate));
    const cycles = [];
    for (let i = 1; i < sorted.length; i++) {
      const diff = this._dayDiff(this._localDate(sorted[i].startDate), this._localDate(sorted[i-1].startDate));
      if (diff >= 21 && diff <= 45) cycles.push(diff);
    }
    const periods = sorted.filter(r => r.endDate).map(r =>
      this._dayDiff(this._localDate(r.endDate), this._localDate(r.startDate)) + 1
    ).filter(l => l >= 2 && l <= 10);
    const avgCycle = cycles.length > 0 ? Math.round(cycles.reduce((a,b)=>a+b,0)/cycles.length) : 0;
    const avgPeriod = periods.length > 0 ? Math.round(periods.reduce((a,b)=>a+b,0)/periods.length) : 0;
    const confidence = this.state.prediction ? Math.round(this.state.prediction.confidence * 100) : 0;
    document.getElementById('bf-stat-cycle').textContent = avgCycle > 0 ? avgCycle + '天' : '--';
    document.getElementById('bf-stat-period').textContent = avgPeriod > 0 ? avgPeriod + '天' : '--';
    document.getElementById('bf-stat-confidence').textContent = confidence > 0 ? confidence + '%' : '--';
  },

  renderBfAnalysis() {
    const container = document.getElementById('bf-analysis');
    const pred = this.state.prediction;
    const sorted = [...this.state.records].sort((a,b) => b.startDate.localeCompare(a.startDate));
    if (sorted.length === 0) { container.innerHTML = '<div class="analysis-empty">暂无数据</div>'; return; }
    const recent = sorted[0];
    let html = '';
    if (recent) {
      html += `<div class="analysis-card"><h3>📊 周期概览</h3>
        <div class="ac-row"><span>上次经期</span><span>${recent.startDate}</span></div>
        ${recent.endDate ? `<div class="ac-row"><span>结束日期</span><span>${recent.endDate}</span></div>` : '<div class="ac-row"><span>状态</span><span style="color:var(--pink)">进行中</span></div>'}
        ${pred ? `<div class="ac-row"><span>预测下次</span><span>${this._fmt(pred.nextPeriodStart)}</span></div>` : ''}
      </div>`;
    }
    container.innerHTML = html;
  },

  renderBfMamiMessages() {
    const container = document.getElementById('bf-mami-tips');
    if (!container) return;
    const msgs = this.state.partnerMessages;
    if (!msgs || msgs.length === 0) {
      container.innerHTML = '<p class="desc">她还没有给你发送消息 💕</p>';
      return;
    }
    container.innerHTML = '<div class="mami-msg-list">' +
      [...msgs].reverse().map(m =>
        `<div class="mami-msg-item"><span class="mami-msg-text">${this._escapeHtml(m.text)}</span></div>`
      ).join('') +
    '</div>';
  },

  async generateBfSuggestion() {
    const token = this.state.auth.token;
    if (!token) { this.showToast('请先登录'); return; }
    try {
      const resp = await fetch(API_BASE + '/api/ai-suggestions', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (resp.ok) {
        const data = await resp.json();
        const area = document.getElementById('bf-ai-area');
        if (data.suggestions && data.suggestions.length > 0) {
          area.innerHTML = data.suggestions.map(s =>
            `<div class="suggestion-box"><p>💝 <strong>${s.title}</strong><br>${s.text}</p></div>`
          ).join('') + '<button class="btn-primary" onclick="APP.generateBfSuggestion()">刷新提醒</button>';
        } else {
          area.innerHTML = '<div class="suggestion-box"><p>💝 多关心她最近的状态，陪伴是最长情的告白</p></div>';
        }
      }
    } catch(e) {
      this.showToast('生成失败');
    }
  },

  // ====== Boyfriend Tips ======
  renderMamiMessages() {
    const container = document.getElementById('mami-tips');
    if (!container) return;
    const msgs = this.state.partnerMessages;
    if (!msgs || msgs.length === 0) {
      container.innerHTML = '<div class="tips-empty">📋 还没有发送过消息，输入后发送会同步到伴侣端</div>';
      return;
    }
    container.innerHTML = '<div class="mami-msg-list">' +
      [...msgs].reverse().map(m =>
        `<div class="mami-msg-item"><span class="mami-msg-text">${this._escapeHtml(m.text)}</span><span class="mami-msg-time">${m.time || ''}</span></div>`
      ).join('') +
    '</div>';
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // ====== Settings ======
  renderSettings() {
    document.getElementById('setting-blur').checked = this.state.settings.blurPreview;
    document.getElementById('setting-notify').checked = this.state.settings.notifications;
    document.getElementById('setting-dark').checked = this.state.settings.darkMode;
    if (this.state.settings.darkMode) document.body.classList.add('dark');
    // Account info
    const acct = document.getElementById('settings-account');
    if (acct) {
      const user = this.state.auth.user;
      if (user) {
        acct.innerHTML = `<div style="font-size:14px">${user.phone}（${user.role === 'girl' ? '女生' : '男友'}）</div>
          <button class="btn-text" style="color:#E74C3C;padding:4px 8px" onclick="APP.logout()">退出登录</button>`;
      } else {
        acct.innerHTML = `<div style="font-size:14px;color:var(--text-secondary)">未登录</div>
          <button class="btn-primary" style="padding:8px 16px;font-size:13px" onclick="APP.showLoginOverlay()">登录/注册</button>`;
      }
    }
    // Server URL
    const srvInput = document.getElementById('setting-server-url');
    if (srvInput) srvInput.value = localStorage.getItem('server_url') || '';
  },

  saveServerUrl() {
    const input = document.getElementById('setting-server-url');
    const url = input.value.trim().replace(/\/+$/, '');
    if (!url) { localStorage.removeItem('server_url'); this.showToast('已清除，使用页面地址'); return; }
    localStorage.setItem('server_url', url);
    this.showToast('服务器地址已保存，重新加载后生效');
    location.reload();
  },

  exportData() {
    const dataObj = {
      version: 1,
      exportedAt: new Date().toISOString(),
      records: this.state.records,
      symptoms: this.state.symptoms,
      meals: this.state.meals,
      tags: this.state.tags,
      settings: this.state.settings,
    };

    const blob = new Blob([JSON.stringify(dataObj, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `乖宝生理期_备份_${this._fmt(this._localToday())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('备份导出成功');
  },

  importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.records) this.state.records = data.records;
          if (data.symptoms) this.state.symptoms = data.symptoms;
          if (data.meals) this.state.meals = data.meals;
          if (data.tags) this.state.tags = data.tags;
          if (data.settings) this.state.settings = {...this.state.settings, ...data.settings};
          this.saveState();
          this.computePrediction();
          this.computeStats();
          this.renderCalendar();
          this.updatePhaseBanner();
          this.renderLog();
          this.renderDiet();
          this.renderPartner();
          this.renderSettings();
          this.renderStats();
          this.showToast('数据恢复成功');
        } catch(err) {
          this.showToast('文件格式错误');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  },

  clearData() {
    if (confirm('确定要清除所有数据吗？此操作不可撤销！')) {
      if (confirm('再次确认：所有记录将被永久删除！')) {
        this.state.records = [];
        this.state.dailyLogs = {};
        this.state.symptoms = [];
        this.state.meals = [];
        this.state.partnerMessages = [];
        this.saveState();
        this.computePrediction();
        this.computeStats();
        this.renderCalendar();
        this.updatePhaseBanner();
        this.renderLog();
        this.renderDiet();
        this.renderPartner();
        this.renderStats();
        this.showToast('所有数据已清除');
      }
    }
  },

  // ====== Notifications ======
  requestNotifyPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  },

  sendNotification(title, body) {
    if (!this.state.settings.notifications) return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: '/favicon.ico' });
      } catch(e) {}
    }
  },

  schedulePeriodReminder() {
    if (!this.state.settings.notifications) return;
    const pred = this.state.prediction;
    if (!pred || !pred.nextPeriodStart) return;
    const today = this._localToday();
    const next = pred.nextPeriodStart;
    const daysUntil = this._dayDiff(next, today);
    // 1 day before
    if (daysUntil === 1) {
      this.sendNotification('🩸 经期提醒', '预计明天经期开始，请提前准备卫生用品');
    }
    // Same day
    if (daysUntil === 0) {
      this.sendNotification('🩸 经期提醒', '今天可能来经期，注意保暖，多喝温水');
    }
  },

  // ====== Helpers ======
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // ====== Health Q&A (DeepSeek) ======
  async askHealthQuestion() {
    const input = document.getElementById('qa-input');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';

    const messages = document.getElementById('qa-messages');
    messages.appendChild(this._qaMsg(question, 'user'));
    messages.scrollTop = messages.scrollHeight;

    const typing = document.createElement('div');
    typing.className = 'qa-msg qa-bot qa-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;

    try {
      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_KEY },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: '你是一个女性健康助手，擅长回答关于生理期、妇科症状、身体调理等问题。回答要简洁、温暖、专业。请用中文回答。' },
            { role: 'user', content: question }
          ],
          max_tokens: 800,
          temperature: 0.7,
        }),
      });
      typing.remove();
      if (!resp.ok) throw new Error('API请求失败: ' + resp.status);
      const data = await resp.json();
      const answer = data.choices?.[0]?.message?.content || '抱歉，暂时无法回答这个问题。';
      messages.appendChild(this._qaMsg(answer, 'bot'));
    } catch(e) {
      typing.remove();
      messages.appendChild(this._qaMsg('抱歉，连接失败，请稍后重试。', 'bot'));
    }
    messages.scrollTop = messages.scrollHeight;
  },

  _qaMsg(text, role) {
    const div = document.createElement('div');
    div.className = 'qa-msg ' + (role === 'user' ? 'qa-user' : 'qa-bot');
    div.textContent = text;
    return div;
  },

  // ====== Toast ======
  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, 2500);
  },
};

const DEFAULT_TAGS = ['痛经','腰痛','头痛','乳房胀痛','腹胀','长痘','食欲增加','失眠','水肿','怕冷','疲劳','便秘','腹泻','头晕','恶心'];
const DEEPSEEK_KEY = localStorage.getItem('deepseek_key') || '';

// Handle visibility change for privacy blur
document.addEventListener('visibilitychange', () => {
  if (document.hidden && APP.state.settings.blurPreview) {
    document.body.style.filter = 'blur(20px)';
  } else {
    document.body.style.filter = 'none';
  }
});

window.APP = APP;

// Init
document.addEventListener('DOMContentLoaded', () => {
  APP.init();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
