import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { getAvailableApis, disableApi, enableAllApis, syncStore, getApiStates, enableApi } from './store';
import { getCategories, addCategory, deleteCategory, addApi, deleteApi, setApiBanState, clearAllManualBans, verifyPassword, updatePassword, initDB, reorderApis, getSetting, updateSetting } from './dataManager';
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
  const { password } = req.body;
  if (await verifyPassword(password)) {
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token });
  }
  return res.status(401).json({ error: '密码错误' });
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
        } else {
          api.isFailing = false;
        }
      }
    }
  }
  res.json(result);
});

adminRouter.post('/category', async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '分类名称不能为空' });
  
  if (name === 'admin' || name === 'api') {
    return res.status(400).json({ error: '保留字，无法作为分类' });
  }

  if (await addCategory(name)) {
    await syncStore();
    return res.json({ success: true });
  }
  return res.status(400).json({ error: '分类已存在' });
});

adminRouter.delete('/category/:name', async (req: Request, res: Response) => {
  if (await deleteCategory(req.params.name)) {
    await syncStore();
    return res.json({ success: true });
  }
  return res.status(404).json({ error: '分类不存在' });
});

adminRouter.post('/api/:category', async (req: Request, res: Response) => {
  const { category } = req.params;
  const { id, url, type, jsonPath } = req.body;
  
  if (!id || !url || !type) return res.status(400).json({ error: '缺失必填字段' });

  if (await addApi(category, { id, url, type, jsonPath })) {
    await syncStore();
    return res.json({ success: true });
  }
  return res.status(400).json({ error: '分类不存在或 ID 已存在' });
});

adminRouter.delete('/api/:category/:id', async (req: Request, res: Response) => {
  if (await deleteApi(req.params.category, req.params.id)) {
    await syncStore();
    return res.json({ success: true });
  }
  return res.status(404).json({ error: '删除失败，找不到该 API' });
});

adminRouter.post('/reset', (req: Request, res: Response) => {
  const count = enableAllApis();
  res.json({ message: `Successfully re-enabled ${count} APIs.` });
});

adminRouter.post('/reset-manual', async (req: Request, res: Response) => {
  const count = await clearAllManualBans();
  await syncStore();
  res.json({ message: `Successfully cleared ${count} manual bans.` });
});

adminRouter.post('/reset/:category/:id', (req: Request, res: Response) => {
  const { category, id } = req.params;
  if (enableApi(category, id)) {
    return res.json({ success: true, message: `已恢复 API: ${id}` });
  }
  return res.status(400).json({ error: `无法恢复 API: ${id} (可能并未熔断或不存在)` });
});

adminRouter.post('/toggle-ban/:category/:id', async (req: Request, res: Response) => {
  const { category, id } = req.params;
  const { isBanned } = req.body;
  
  if (await setApiBanState(category, id, Boolean(isBanned))) {
    await syncStore();
    return res.json({ success: true });
  }
  return res.status(404).json({ error: '找不到该接口' });
});

adminRouter.post('/change-password', async (req: Request, res: Response) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '缺少密码字段' });
  }
  if (await verifyPassword(oldPassword)) {
    await updatePassword(newPassword);
    return res.json({ success: true });
  }
  return res.status(400).json({ error: '原密码错误' });
});

adminRouter.post('/category/:category/reorder', async (req: Request, res: Response) => {
  const { category } = req.params;
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
  const publicDomain = await getSetting('public_domain') || '';
  res.json({ publicDomain });
});

adminRouter.post('/settings', async (req: Request, res: Response) => {
  const { publicDomain } = req.body;
  await updateSetting('public_domain', publicDomain || '');
  res.json({ success: true });
});

app.use('/api/admin', adminRouter);

app.use(express.static(path.join(process.cwd(), 'public/site')));

app.get('/api/public/config', async (req: Request, res: Response) => {
  const categories = await getCategories();
  const domainSetting = await getSetting('public_domain');
  
  let domain = domainSetting;
  if (!domain) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host || `localhost:${PORT}`;
    domain = `${protocol}://${host}`;
  }
  
  domain = domain.replace(/\/$/, '');

  res.json({
    domain,
    categories: Object.keys(categories)
  });
});

app.get('/:category', async (req: Request, res: Response, next: NextFunction) => {
  const { category } = req.params;
  
  if (category === 'admin' || category === 'api') {
    return next();
  }

  const categories = await getCategories();
  
  if (!categories[category]) {
    return res.status(404).send('分类不存在');
  }

  let availableApis = await getAvailableApis(category);
  
  if (availableApis.length === 0) {
    const errorMsg = '当前暂无可用图片服务';
    if (process.env.NODE_ENV === 'development') {
      return res.status(503).json({ error: errorMsg, detail: `分类 '${category}' 下的所有配置 API 均已失效或被禁用。` });
    } else {
      return res.status(503).json({ error: errorMsg });
    }
  }

  const apisToTry = availableApis;
  const errors: any[] = [];

  for (const api of apisToTry) {
    try {
      let targetUrl = '';
      if (api.type === 'direct') {
        const response = await axios.get(api.url, { 
          maxRedirects: 0, 
          timeout: 5000,
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
        const response = await axios.get(api.url, { timeout: 5000 });
        const jsonPath = api.jsonPath || 'url';
        targetUrl = getNestedValue(response.data, jsonPath);
        
        if (!targetUrl || typeof targetUrl !== 'string') {
          throw new Error(`Could not find image URL at path '${jsonPath}' in JSON response.`);
        }
      }

      if (targetUrl) {
        let finalStatus = 200;
        let contentType = '';
        try {
          const headRes = await axios.head(targetUrl, { timeout: 3000, validateStatus: () => true });
          finalStatus = headRes.status;
          contentType = headRes.headers['content-type'] || '';
          
          if (finalStatus === 405 || finalStatus === 403) {
            const getRes = await axios.get(targetUrl, { responseType: 'stream', timeout: 3000, validateStatus: () => true });
            finalStatus = getRes.status;
            contentType = getRes.headers['content-type'] || '';
            if (getRes.data && typeof getRes.data.destroy === 'function') getRes.data.destroy();
          }
        } catch (e: any) {
          throw new Error(`Target URL validation failed: ${e.message}`);
        }

        if (finalStatus === 404) {
          throw new Error('Target URL returned 404 Not Found');
        }
        if (finalStatus >= 400) {
          throw new Error(`Target URL returned error status ${finalStatus}`);
        }
        if (contentType.includes('text/html') || contentType.includes('application/json')) {
          throw new Error(`Target URL is not an image (Content-Type: ${contentType})`);
        }

        return res.redirect(302, targetUrl);
      }

    } catch (err: any) {
      console.error(`[Router] API 请求失败 - ${api.id}:`, err.message);
      disableApi(category, api.id);
      errors.push({ id: api.id, url: api.url, error: err.message });
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
    console.log(`[Server] 随机图片聚合服务已启动: http://localhost:${PORT}`);
    console.log(`[Server] 管理后台: http://localhost:${PORT}/admin`);
    console.log(`[Server] 当前运行环境: ${process.env.NODE_ENV || 'development'}`);
  });
}).catch(err => {
  console.error('[Server] Failed to initialize Database:', err);
  process.exit(1);
});
