document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('categories-grid');
  
  try {
    const res = await fetch('/api/public/config');
    if (!res.ok) throw new Error('无法获取配置');
    const data = await res.json();
    
    if (data.categories.length === 0) {
      grid.innerHTML = '<div class="loading-state">当前暂无可用分类，请在后台添加。</div>';
      return;
    }
    
    let html = '';
    data.categories.forEach(cat => {
      const fullUrl = `${data.domain}/${cat}`;
      html += `
        <div class="category-card glass-panel" onclick="copyToClipboard('${fullUrl}')">
          <div class="cat-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          </div>
          <h3 class="cat-name">${cat}</h3>
          <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 12px;">调用该接口获取随机图片</p>
          <div class="cat-url">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${fullUrl}</span>
            <button class="copy-btn" title="复制链接">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        </div>
      `;
    });
    grid.innerHTML = html;
  } catch (err) {
    grid.innerHTML = `<div class="loading-state" style="color: #ef4444;">加载失败: ${err.message}</div>`;
  }
});

let toastTimeout;
window.copyToClipboard = function(text) {
  navigator.clipboard.writeText(text).then(() => {
    const toast = document.getElementById('toast');
    toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }).catch(err => {
    console.error('复制失败:', err);
  });
};
