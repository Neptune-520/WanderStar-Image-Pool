import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { getAvailableApis, disableApi, enableAllApis, syncStore, getApiStates, enableApi } from './store';
import { getCategories, addCategory, editCategory, deleteCategory, addApi, editApi, deleteApi, setApiBanState, clearAllManualBans, verifyLogin, updatePassword, initDB, reorderApis, getSetting, getAllSettings, updateSetting, updateSettingsBatch } from './dataManager';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'rand-pic-secret-key-super-safe';

app.use(express.json());

app.use('/admin', express.static(path.join(process.cwd(), 'public/admin')));

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

app.post('/api/admin/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (await verifyLogin(username, password)) {
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token });
  }
  return res.status(401).json({ error: '用户名或密码错误' });
});

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }
  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token 无效或已过期' });
  }
}

const adminRouter = express.Router();
adminRouter.use(authMiddleware);

adminRouter.get('/data', async (req: Request, res: Response) => {
  const categories = await getCategories();
  const states = getApiStates();
  
  const result: any = JSON.parse(JSON.stringify(categories));
  for (const catName in result) {
    if (result[catName].apis) {
      for (const api of result[catName].apis) {
        const state = states[`${catName}_${api.id}`];
        if (state && state.isDisabled) {
          api.isFailing = true;
          api.disabledAt = state.disabledAt;
          api.reason = state.reason;
        } else {
          api.isFailing = false;
        }
      }
    }
  }
  res.json(result);
});

adminRouter.post('/category', async (req: Request, res: Response) => {
  const { name, displayName, description } = req.body;
  if (!name || !name.match(/^[A-Za-z0-9_-]+$/)) return res.status(400).json({ error: '端点 Slug 格式无效' });
  
  if (name === 'admin' || name === 'api') {
    return res.status(400).json({ error: '保留字，无法作为端点' });
  }

  if (await addCategory(name, displayName || name, description || '')) {
    await syncStore();
    return res.json({ success: true });
  }
  return res.status(400).json({ error: '端点已存在' });
});

adminRouter.put('/category/:name', async (req: Request, res: Response) => {
  const { displayName, description } = req.body;
  if (await editCategory(req.params.name as string, displayName, description)) {
    await syncStore();
    return res.json({ success: true });
  }
  return res.status(400).json({ error: '端点更新失败' });
});

adminRouter.delete('/category/:name', async (req: Request, res: Response) => {
  if (await deleteCategory(req.params.name as string)) {
    await syncStore();
    return res.json({ success: true });
  }
  return res.status(404).json({ error: '端点不存在' });
});

adminRouter.post('/api/:category', async (req: Request, res: Response) => {
  const category = req.params.category as string;
  const { id, url, type, jsonPath } = req.body;
  
  if (!id || !url || !type) return res.status(400).json({ error: '缺失必填字段' });

  if (await addApi(category, { id, url, type, jsonPath })) {
    await syncStore();
    return res.json({ success: true });
  }
  return res.status(400).json({ error: '保存失败，ID 已存在或其它错误' });
});

adminRouter.put('/api/:category/:id', async (req: Request, res: Response) => {
  const category = req.params.category as string;
  const oldId = req.params.id as string;
  const { id, url, type, jsonPath, isManuallyBanned } = req.body;
  
  if (!id || !url || !type) return res.status(400).json({ error: '缺失必填字段' });

  if (await editApi(category, oldId, { id, url, type, jsonPath, isManuallyBanned })) {
    await syncStore();
    return res.json({ success: true });
  }
  return res.status(400).json({ error: '更新失败' });
});

adminRouter.delete('/api/:category/:id', async (req: Request, res: Response) => {
  if (await deleteApi(req.params.category as string, req.params.id as string)) {
    await syncStore();
    return res.json({ success: true });
  }
  return res.status(404).json({ error: '删除失败，找不到该 API' });
});

adminRouter.post('/reset', (req: Request, res: Response) => {
  const count = enableAllApis();
  res.json({ message: `成功解封了 ${count} 个自动熔断 API。` });
});

adminRouter.post('/reset/:category', (req: Request, res: Response) => {
  const count = enableAllApis(req.params.category as string);
  res.json({ message: `成功解封了 ${count} 个自动熔断 API。` });
});

adminRouter.post('/reset-manual', async (req: Request, res: Response) => {
  const count = await clearAllManualBans();
  await syncStore();
  res.json({ message: `成功清除了 ${count} 个手动封禁 API。` });
});

adminRouter.post('/reset-manual/:category', async (req: Request, res: Response) => {
  const count = await clearAllManualBans(req.params.category as string);
  await syncStore();
  res.json({ message: `成功清除了 ${count} 个手动封禁 API。` });
});

adminRouter.post('/reset-api/:category/:id', (req: Request, res: Response) => {
  const category = req.params.category as string;
  const id = req.params.id as string;
  if (enableApi(category, id)) {
    return res.json({ success: true, message: `已恢复 API: ${id}` });
  }
  return res.status(400).json({ error: `无法恢复 API: ${id} (可能并未熔断或不存在)` });
});

adminRouter.post('/toggle-ban/:category/:id', async (req: Request, res: Response) => {
  const category = req.params.category as string;
  const id = req.params.id as string;
  const { isBanned } = req.body;
  
  if (await setApiBanState(category, id, Boolean(isBanned))) {
    await syncStore();
    return res.json({ success: true });
  }
  return res.status(404).json({ error: '找不到该接口' });
});

adminRouter.post('/change-password', async (req: Request, res: Response) => {
  const { username, oldPassword, newPassword } = req.body;
  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({ error: '缺少字段' });
  }
  if (await verifyLogin(username, oldPassword)) {
    await updatePassword(newPassword);
    return res.json({ success: true });
  }
  return res.status(400).json({ error: '原账号或密码错误' });
});

adminRouter.post('/category/:category/reorder', async (req: Request, res: Response) => {
  const category = req.params.category as string;
  const { apiIds } = req.body;
  if (!Array.isArray(apiIds)) {
    return res.status(400).json({ error: '无效的数据格式' });
  }
  
  if (await reorderApis(category, apiIds)) {
    await syncStore();
    return res.json({ success: true });
  }
  return res.status(500).json({ error: '排序保存失败' });
});

adminRouter.get('/settings', async (req: Request, res: Response) => {
  const settings = await getAllSettings();
  // Don't send passwords
  delete settings.admin_password;
  res.json(settings);
});

adminRouter.post('/settings', async (req: Request, res: Response) => {
  await updateSettingsBatch(req.body);
  res.json({ success: true });
});

app.use('/api/admin', adminRouter);

app.use(express.static(path.join(process.cwd(), 'public/site')));

app.get('/api/public/config', async (req: Request, res: Response) => {
  const categories = await getCategories();
  const settings = await getAllSettings();
  
  let domain = settings.public_domain;
  if (!domain) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host || `localhost:${PORT}`;
    domain = `${protocol}://${host}`;
  }
  
  domain = domain.replace(/\/$/, '');

  const catsArray = Object.values(categories).map(c => ({
    name: c.name,
    displayName: c.displayName,
    description: c.description,
    apiCount: c.apis.length
  }));

  res.json({
    domain,
    categories: catsArray,
    settings: {
      site_name: settings.site_name,
      site_logo: settings.site_logo,
      home_text: settings.home_text,
      announcement: settings.announcement,
      footer_info: settings.footer_info,
      bg_type: settings.bg_type,
      bg_value: settings.bg_value,
      contact_image: settings.contact_image,
      contact_text: settings.contact_text,
      contact_socials: settings.contact_socials
    }
  });
});

app.get('/:category', async (req: Request, res: Response, next: NextFunction) => {
  const category = req.params.category as string;
  
  if (category === 'admin' || category === 'api') {
    return next();
  }

  const categories = await getCategories();
  
  if (!categories[category]) {
    return res.status(404).send('端点不存在');
  }

  let availableApis = await getAvailableApis(category);
  
  if (availableApis.length === 0) {
    const errorMsg = '当前暂无可用图片服务';
    return res.status(503).json({ error: errorMsg, detail: `端点 '${category}' 下的所有配置 API 均已失效或被禁用。` });
  }

  const apisToTry = availableApis;
  const errors: any[] = [];
  
  const timeoutMs = parseInt(await getSetting('api_timeout_ms') || '1500', 10);
  const maxRetries = parseInt(await getSetting('api_retry_count') || '2', 10);

  for (const api of apisToTry) {
    let apiSuccess = false;
    let lastError: any = null;
    let targetUrl = '';

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (api.type === 'direct') {
          const response = await axios.get(api.url, { 
            maxRedirects: 0, 
            timeout: timeoutMs,
            responseType: 'stream',
            validateStatus: (status) => status >= 200 && status < 400 
          });

          if (response.data && typeof response.data.destroy === 'function') {
            response.data.destroy(); 
          }

          if (response.status >= 300 && response.status < 400 && response.headers.location) {
            targetUrl = response.headers.location;
          } else if (response.status === 200) {
            targetUrl = api.url;
          } else {
            throw new Error(`Unexpected status code: ${response.status}`);
          }
        } else if (api.type === 'json') {
          const response = await axios.get(api.url, { timeout: timeoutMs });
          const jsonPath = api.jsonPath || 'url';
          targetUrl = getNestedValue(response.data, jsonPath);
          
          if (!targetUrl || typeof targetUrl !== 'string') {
            throw new Error(`Could not find image URL at path '${jsonPath}' in JSON response.`);
          }
        }

        if (targetUrl) {
          apiSuccess = true;
          break;
        }
      } catch (err: any) {
        lastError = err;
        if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
          lastError.reason = 'timeout';
        } else {
          lastError.reason = 'error';
        }
      }
    }

    if (apiSuccess && targetUrl) {
      let finalStatus = 200;
      let contentType = '';
      try {
        const headRes = await axios.head(targetUrl, { timeout: timeoutMs, validateStatus: () => true });
        finalStatus = headRes.status;
        contentType = String(headRes.headers['content-type'] || '');
        
        if (finalStatus === 405 || finalStatus === 403) {
          const getRes = await axios.get(targetUrl, { responseType: 'stream', timeout: timeoutMs, validateStatus: () => true });
          finalStatus = getRes.status;
          contentType = String(getRes.headers['content-type'] || '');
          if (getRes.data && typeof getRes.data.destroy === 'function') getRes.data.destroy();
        }
      } catch (e: any) {
        // Validation failed, but maybe it's just CORS/anti-hotlink on HEAD. We still pass it through if initial API succeeded.
        finalStatus = 200; 
      }

      if (finalStatus === 404 || finalStatus >= 500) {
        lastError = new Error(`Target URL returned error status ${finalStatus}`);
        lastError.reason = 'error';
        apiSuccess = false;
      } else if (contentType.includes('text/html') || contentType.includes('application/json')) {
        lastError = new Error(`Target URL is not an image (Content-Type: ${contentType})`);
        lastError.reason = 'error';
        apiSuccess = false;
      }
    }

    if (apiSuccess && targetUrl) {
      return res.redirect(302, targetUrl);
    } else {
      if (lastError) {
        disableApi(category, api.id, lastError.reason || 'error');
        errors.push({ id: api.id, url: api.url, error: lastError.message });
      }
    }
  }

  const errorMsg = '当前暂无可用图片服务';
  if (process.env.NODE_ENV === 'development') {
    return res.status(502).json({ 
      error: errorMsg, 
      detail: '本次请求尝试了所有可用 API，但全部失败',
      errors 
    });
  } else {
    return res.status(502).json({ error: errorMsg });
  }
});



initDB().then(async () => {
  await syncStore();
  app.listen(PORT, () => {
    console.log(`[Server] 漫游星图 (WanderStar Image Pool) 服务已启动: http://localhost:${PORT}`);
    console.log(`[Server] 管理后台: http://localhost:${PORT}/admin`);
    console.log(`[Server] 当前运行环境: ${process.env.NODE_ENV || 'development'}`);
  });
}).catch(err => {
  console.error('[Server] Failed to initialize Database:', err);
  process.exit(1);
});
