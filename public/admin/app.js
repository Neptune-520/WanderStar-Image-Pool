let authToken = null;
try { authToken = localStorage.getItem('randpic_token'); } catch (e) {}

const views = {
  login: document.getElementById('login-view'),
  dashboard: document.getElementById('dashboard-view')
};

const panels = {
  category: document.getElementById('panel-category'),
  settings: document.getElementById('panel-settings')
};

let currentManageCategory = null;
let allCategoriesData = {};
let systemSettings = {};

const api = {
  async req(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    try {
      const res = await fetch(`/api/admin${endpoint}`, { ...options, headers });
      const data = await res.json();
      if (res.status === 401) {
        logout();
        throw new Error('鉴权失败，请重新登录');
      }
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    } catch (err) {
      console.error(err);
      throw err;
    }
  }
};

function switchView(viewName) {
  Object.values(views).forEach(v => v && v.classList.remove('active'));
  if (views[viewName]) views[viewName].classList.add('active');
}

function switchPanel(panelName) {
  Object.values(panels).forEach(p => p && p.classList.add('hidden'));
  if (panels[panelName]) panels[panelName].classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
}

function checkAuth() {
  if (authToken) {
    switchView('dashboard');
    loadData();
    loadSettings();
  } else {
    switchView('login');
  }
}

function logout() {
  authToken = null;
  try { localStorage.removeItem('randpic_token'); } catch (e) {}
  switchView('login');
}

async function doLogin() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  if (!username || !password) return;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '登录失败');
    
    authToken = data.token;
    try { localStorage.setItem('randpic_token', authToken); } catch (e) {}
    document.getElementById('password').value = '';
    checkAuth();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

document.getElementById('btn-login').addEventListener('click', doLogin);
document.getElementById('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
});
document.getElementById('btn-logout').addEventListener('click', logout);

document.getElementById('nav-settings').addEventListener('click', function() {
  switchPanel('settings');
  this.classList.add('active');
  currentManageCategory = null;
});

async function loadData() {
  try {
    allCategoriesData = await api.req('/data');
    renderSidebarCategories(allCategoriesData);
    
    if (currentManageCategory && allCategoriesData[currentManageCategory]) {
      renderCategoryApis(currentManageCategory, allCategoriesData[currentManageCategory]);
    } else {
      currentManageCategory = null;
      if (panels.settings.classList.contains('hidden')) {
        document.getElementById('manage-cat-apis-list').innerHTML = `<div class="empty-state">请从左侧选择一个端点进行管理</div>`;
        document.getElementById('manage-cat-title').textContent = '选择一个端点';
        document.getElementById('manage-cat-link').style.display = 'none';
      }
    }
  } catch (err) {
    alert('加载数据失败: ' + err.message);
  }
}

async function loadSettings() {
  try {
    systemSettings = await api.req('/settings');
    const fields = [
      'public_domain', 'api_retry_count', 'api_timeout_ms',
      'site_name', 'site_logo', 'home_text', 'announcement', 'footer_info',
      'bg_type', 'bg_value', 'contact_image', 'contact_text', 'contact_socials'
    ];
    fields.forEach(f => {
      const el = document.getElementById(`setting-${f}`);
      if (el) el.value = systemSettings[f] || '';
    });
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function renderSidebarCategories(data) {
  const container = document.getElementById('sidebar-category-list');
  container.innerHTML = '';

  Object.keys(data).forEach(catName => {
    const cat = data[catName];
    const li = document.createElement('li');
    li.className = 'nav-item';
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    
    let isActive = (currentManageCategory === catName && !panels.settings.classList.contains('hidden'));
    if (isActive) li.classList.add('active');

    li.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        ${cat.displayName}
      </div>
      <div class="cat-quick-actions" style="display:${isActive ? 'flex' : 'none'}; gap:4px;">
        <button class="btn-icon-small" onclick="event.stopPropagation(); editCategoryModal('${catName}')" title="编辑"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
        <button class="btn-icon-small danger" onclick="event.stopPropagation(); deleteCategoryPrompt('${catName}')" title="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
      </div>
    `;
    
    li.onclick = () => {
      switchPanel('category');
      document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('active');
        const actions = el.querySelector('.cat-quick-actions');
        if (actions) actions.style.display = 'none';
      });
      li.classList.add('active');
      li.querySelector('.cat-quick-actions').style.display = 'flex';
      currentManageCategory = catName;
      renderCategoryApis(catName, cat);
    };
    
    container.appendChild(li);
  });
}

function renderCategoryApis(catName, catData) {
  document.getElementById('manage-cat-title').textContent = `${catData.displayName}`;
  
  const domain = (systemSettings.public_domain || window.location.origin).replace(/\/$/, '');
  const linkEl = document.getElementById('manage-cat-link');
  linkEl.href = `${domain}/${catName}`;
  linkEl.textContent = `${domain}/${catName}`;
  linkEl.style.display = 'inline-block';

  const listContainer = document.getElementById('manage-cat-apis-list');
  
  if (!catData || !catData.apis || catData.apis.length === 0) {
    listContainer.innerHTML = `<div class="empty-state">该端点下暂无接口，请添加</div>`;
    return;
  }

  let html = '';
  catData.apis.forEach((apiConf, index) => {
    const isFailing = apiConf.isFailing;
    const isBanned = apiConf.isManuallyBanned;
    const reason = apiConf.reason;
    
    let statusTags = '';
    if (isBanned) {
      statusTags += `<span class="api-type-tag" style="background: rgba(239, 68, 68, 0.15); color: #ef4444;">已手动封禁</span> `;
    } else if (isFailing) {
      let failText = reason === 'timeout' ? '访问超时' : '异常熔断';
      statusTags += `<span class="api-type-tag" style="background: rgba(245, 158, 11, 0.15); color: #d97706;">${failText}</span> `;
    } else {
      statusTags += `<span class="api-type-tag" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">运行正常</span>`;
    }

    html += `
      <div class="api-item sortable-item" data-id="${apiConf.id}" style="${(isFailing || isBanned) ? 'opacity: 0.7;' : ''}">
        <div class="drag-handle" title="拖动排序">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </div>
        <div class="api-info">
          <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 4px;">
            <span class="api-id" style="${isBanned ? 'color: #ef4444; text-decoration: line-through;' : ''}">${apiConf.id}</span>
            <span class="api-type-tag">${apiConf.type === 'direct' ? 'Direct' : 'JSON'}</span>
            ${statusTags}
            <span style="margin-left: 8px; font-size: 0.75rem; color: var(--text-secondary);">优先级: ${index + 1}</span>
          </div>
          <div class="api-url" title="${apiConf.url}">${apiConf.url}</div>
        </div>
        <div style="display: flex; gap: 16px; align-items: center; margin-left: 16px;">
          ${isFailing && !isBanned ? `<button class="btn-text" style="font-size: 0.8rem; color: #10b981;" onclick="resumeApi('${catName}', '${apiConf.id}')">恢复</button>` : ''}
          <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
            <label class="switch" title="手动封禁开关">
              <input type="checkbox" onchange="toggleApiBan('${catName}', '${apiConf.id}', this.checked)" ${isBanned ? 'checked' : ''}>
              <span class="slider ${isBanned ? 'banned' : ''}"></span>
            </label>
            <span style="font-size: 0.7rem; color: var(--text-secondary);">${isBanned ? '已封禁' : '已启用'}</span>
          </div>
          <button class="btn-icon" onclick="editApiModal('${catName}', '${apiConf.id}')" title="编辑">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="btn-icon danger" onclick="deleteApi('${catName}', '${apiConf.id}')" title="删除">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
        </div>
      </div>
    `;
  });
  listContainer.innerHTML = html;

  if (window.Sortable) {
    if (window.currentSortable) window.currentSortable.destroy();
    window.currentSortable = Sortable.create(listContainer, {
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      onEnd: async function () {
        const items = listContainer.querySelectorAll('.sortable-item');
        const newOrder = Array.from(items).map(item => item.getAttribute('data-id'));
        try {
          await api.req(`/category/${catName}/reorder`, {
            method: 'POST',
            body: JSON.stringify({ apiIds: newOrder })
          });
          loadData();
        } catch (err) {
          alert('排序保存失败: ' + err.message);
        }
      }
    });
  }
}

document.getElementById('form-settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fields = [
    'public_domain', 'api_retry_count', 'api_timeout_ms',
    'site_name', 'site_logo', 'home_text', 'announcement', 'footer_info',
    'bg_type', 'bg_value', 'contact_image', 'contact_text', 'contact_socials'
  ];
  const payload = {};
  fields.forEach(f => {
    const el = document.getElementById(`setting-${f}`);
    if (el) payload[f] = el.value;
  });
  try {
    await api.req('/settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    alert('系统设置保存成功！');
    loadSettings();
  } catch (err) {
    alert(err.message);
  }
});

window.toggleApiBan = async function(catName, apiId, isBanned) {
  try {
    await api.req(`/toggle-ban/${catName}/${apiId}`, {
      method: 'POST',
      body: JSON.stringify({ isBanned })
    });
    loadData();
  } catch (err) {
    alert('操作失败: ' + err.message);
  }
}

document.getElementById('btn-add-api-in-cat').addEventListener('click', () => {
  if (currentManageCategory) {
    document.getElementById('api-modal-title').textContent = '添加新 API';
    document.getElementById('api-is-edit').value = '0';
    document.getElementById('api-cat-name').value = currentManageCategory;
    document.getElementById('form-add-api').reset();
    document.getElementById('json-path-group').style.display = 'none';
    showModal('modal-add-api');
  }
});

window.editApiModal = function(catName, apiId) {
  const cat = allCategoriesData[catName];
  if (!cat) return;
  const apiConf = cat.apis.find(a => a.id === apiId);
  if (!apiConf) return;

  document.getElementById('api-modal-title').textContent = '编辑 API';
  document.getElementById('api-is-edit').value = '1';
  document.getElementById('api-old-id').value = apiId;
  document.getElementById('api-cat-name').value = catName;
  
  document.getElementById('api-id').value = apiConf.id;
  document.getElementById('api-url').value = apiConf.url;
  document.getElementById('api-type').value = apiConf.type;
  document.getElementById('api-json-path').value = apiConf.jsonPath || '';
  document.getElementById('json-path-group').style.display = apiConf.type === 'json' ? 'flex' : 'none';
  
  showModal('modal-add-api');
}

window.deleteCategoryPrompt = async function(catName) {
  if (confirm(`确定要删除端点 [${catName}] 及其下的所有接口吗？`)) {
    try {
      await api.req(`/category/${catName}`, { method: 'DELETE' });
      if (currentManageCategory === catName) currentManageCategory = null;
      loadData();
    } catch (err) {
      alert(err.message);
    }
  }
};

document.getElementById('btn-edit-category').addEventListener('click', () => {
  if (currentManageCategory) editCategoryModal(currentManageCategory);
});

window.editCategoryModal = function(catName) {
  const cat = allCategoriesData[catName];
  if (!cat) return;
  document.getElementById('cat-modal-title').textContent = '编辑端点';
  document.getElementById('cat-is-edit').value = '1';
  document.getElementById('cat-old-name').value = catName;
  
  document.getElementById('cat-name').value = cat.name;
  document.getElementById('cat-name').disabled = true; // URL slug shouldn't be edited easily, but if they want to, they should recreate. Or we can allow it if API supports it. Wait, API PUT /category/:name only changes displayName/description. So disable name editing.
  
  document.getElementById('cat-display-name').value = cat.displayName;
  document.getElementById('cat-description').value = cat.description;
  showModal('modal-add-category');
};

function showModal(id) { document.getElementById(id).classList.add('active'); }
function hideModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active')); }
document.querySelectorAll('.btn-close-modal').forEach(btn => {
  btn.addEventListener('click', function() { this.closest('.modal-overlay').classList.remove('active'); });
});

document.getElementById('btn-add-category').addEventListener('click', () => {
  document.getElementById('cat-modal-title').textContent = '新增端点';
  document.getElementById('cat-is-edit').value = '0';
  document.getElementById('form-add-category').reset();
  document.getElementById('cat-name').disabled = false;
  showModal('modal-add-category');
});

document.getElementById('form-add-category').addEventListener('submit', async (e) => {
  e.preventDefault();
  const isEdit = document.getElementById('cat-is-edit').value === '1';
  const name = document.getElementById('cat-name').value.trim();
  const displayName = document.getElementById('cat-display-name').value.trim();
  const description = document.getElementById('cat-description').value.trim();
  
  try {
    if (isEdit) {
      const oldName = document.getElementById('cat-old-name').value;
      await api.req(`/category/${oldName}`, { method: 'PUT', body: JSON.stringify({ displayName, description }) });
    } else {
      await api.req('/category', { method: 'POST', body: JSON.stringify({ name, displayName, description }) });
      currentManageCategory = name;
    }
    hideModals();
    if (!isEdit) switchPanel('category');
    loadData();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('api-type').addEventListener('change', function(e) {
  document.getElementById('json-path-group').style.display = e.target.value === 'json' ? 'flex' : 'none';
});

document.getElementById('form-add-api').addEventListener('submit', async (e) => {
  e.preventDefault();
  const isEdit = document.getElementById('api-is-edit').value === '1';
  const oldId = document.getElementById('api-old-id').value;
  const category = document.getElementById('api-cat-name').value;
  
  const payload = {
    id: document.getElementById('api-id').value.trim(),
    url: document.getElementById('api-url').value.trim(),
    type: document.getElementById('api-type').value,
    jsonPath: document.getElementById('api-json-path').value.trim()
  };
  
  try {
    if (isEdit) {
      const apiConf = allCategoriesData[category]?.apis.find(a => a.id === oldId);
      payload.isManuallyBanned = apiConf ? apiConf.isManuallyBanned : false;
      await api.req(`/api/${category}/${oldId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api.req(`/api/${category}`, { method: 'POST', body: JSON.stringify(payload) });
    }
    hideModals();
    loadData();
  } catch (err) {
    alert(err.message);
  }
});

window.deleteApi = async function(category, id) {
  if (confirm(`确定要删除接口 [${id}] 吗？`)) {
    try {
      await api.req(`/api/${category}/${id}`, { method: 'DELETE' });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  }
}

document.getElementById('btn-reset-cat-auto').addEventListener('click', async () => {
  if (currentManageCategory) {
    try {
      const res = await api.req(`/reset/${currentManageCategory}`, { method: 'POST' });
      alert(res.message || '解封成功');
      loadData();
    } catch (err) { alert(err.message); }
  }
});

document.getElementById('btn-reset-cat-manual').addEventListener('click', async () => {
  if (currentManageCategory) {
    if (confirm('确定要清除当前端点下所有 API 的手动封禁状态吗？')) {
      try {
        const res = await api.req(`/reset-manual/${currentManageCategory}`, { method: 'POST' });
        alert(res.message || '当前端点手动封禁已清除');
        loadData();
      } catch (err) { alert(err.message); }
    }
  }
});

document.getElementById('form-change-pwd').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('old-username').value;
  const oldPassword = document.getElementById('old-pwd').value;
  const newPassword = document.getElementById('new-pwd').value;
  if (!username || !oldPassword || !newPassword) return;
  try {
    await api.req('/change-password', {
      method: 'POST',
      body: JSON.stringify({ username, oldPassword, newPassword })
    });
    alert('账号或密码修改成功，请重新登录！');
    logout();
  } catch (err) {
    alert(err.message);
  }
});

window.resumeApi = async function(catName, id) {
  try {
    await api.req(`/reset-api/${catName}/${id}`, { method: 'POST' });
    loadData();
  } catch (err) {
    alert(err.message);
  }
}

checkAuth();
