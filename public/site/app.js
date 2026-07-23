let pageData = null;

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  
  try {
    const res = await fetch('/api/public/config');
    if (!res.ok) throw new Error('无法获取配置');
    pageData = await res.json();
    
    applySettings(pageData.settings);
    renderCategories(pageData);
    
    if (pageData.settings.announcement) {
      document.getElementById('announcement-content').innerHTML = pageData.settings.announcement;
      document.getElementById('announcement-modal').classList.add('active');
    }
  } catch (err) {
    document.getElementById('home-grid').innerHTML = `<div class="loading-state" style="color: #ef4444;">加载失败: ${err.message}</div>`;
    document.getElementById('api-grid').innerHTML = `<div class="loading-state" style="color: #ef4444;">加载失败: ${err.message}</div>`;
  }
});

function setupNavigation() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('data-target');
      switchTab(targetId);
    });
  });
}

window.switchTab = function(targetId) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const activeLink = document.querySelector(`.nav-link[data-target="${targetId}"]`);
  if (activeLink) activeLink.classList.add('active');

  document.querySelectorAll('.page-view').forEach(view => view.classList.remove('active'));
  document.getElementById(targetId).classList.add('active');
  window.scrollTo(0, 0);
};

function applySettings(settings) {
  if (settings.site_name) {
    document.getElementById('page-title').textContent = settings.site_name;
    document.getElementById('dynamic-site-name').textContent = settings.site_name;
  }
  
  if (settings.site_logo) {
    if (settings.site_logo.trim().startsWith('<svg')) {
      document.getElementById('dynamic-logo').innerHTML = settings.site_logo;
    } else {
      document.getElementById('dynamic-logo').innerHTML = `<img src="${settings.site_logo}" style="height:28px; border-radius:4px;" />`;
    }
  }

  if (settings.home_text) {
    document.getElementById('home-subtitle').textContent = settings.home_text;
  }

  if (settings.footer_info) {
    document.getElementById('dynamic-footer').innerHTML = settings.footer_info;
  }

  if (settings.bg_type === 'color' && settings.bg_value) {
    document.getElementById('dynamic-body').style.background = settings.bg_value;
    hideShapes();
  } else if (settings.bg_type === 'gradient' && settings.bg_value) {
    document.getElementById('dynamic-body').style.background = settings.bg_value;
    hideShapes();
  } else if (settings.bg_type === 'image' && settings.bg_value) {
    document.getElementById('dynamic-body').style.backgroundImage = `url(${settings.bg_value})`;
    document.getElementById('dynamic-body').style.backgroundSize = 'cover';
    document.getElementById('dynamic-body').style.backgroundAttachment = 'fixed';
    document.getElementById('dynamic-body').style.backgroundPosition = 'center';
    hideShapes();
  }

  if (settings.contact_image) {
    document.getElementById('contact-image').src = settings.contact_image;
    document.getElementById('contact-image-container').style.display = 'block';
  }
  if (settings.contact_text) {
    document.getElementById('contact-text').innerHTML = settings.contact_text;
  }
  if (settings.contact_socials) {
    try {
      const socials = JSON.parse(settings.contact_socials);
      let html = '';
      socials.forEach(s => {
        html += `<a href="${s.url}" target="_blank" class="btn btn-outline">${s.name}</a>`;
      });
      document.getElementById('contact-socials').innerHTML = html;
    } catch (e) {
      console.error('Failed to parse contact socials JSON', e);
    }
  }
}

function hideShapes() {
  document.querySelectorAll('.bg-shape').forEach(el => el.style.display = 'none');
}

function renderCategories(data) {
  const homeGrid = document.getElementById('home-grid');
  const apiGrid = document.getElementById('api-grid');
  
  if (data.categories.length === 0) {
    const emptyHtml = '<div class="loading-state">当前暂无可用端点。</div>';
    homeGrid.innerHTML = emptyHtml;
    apiGrid.innerHTML = emptyHtml;
    return;
  }
  
  let allHtml = '';
  let homeHtml = '';

  data.categories.forEach((cat, index) => {
    const fullUrl = `${data.domain}/${cat.name}`;
    const cardHtml = `
      <div class="category-card glass-panel" onclick="copyToClipboard('${fullUrl}')">
        <div class="cat-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
        </div>
        <h3 class="cat-name">${cat.displayName}</h3>
        <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 12px; height:42px; overflow:hidden;">${cat.description || '调用该接口获取随机图片'}</p>
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
    
    allHtml += cardHtml;
    if (index < 3) {
      homeHtml += cardHtml;
    }
  });

  homeGrid.innerHTML = homeHtml;
  apiGrid.innerHTML = allHtml;
}

window.closeAnnouncement = function() {
  document.getElementById('announcement-modal').classList.remove('active');
};

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
