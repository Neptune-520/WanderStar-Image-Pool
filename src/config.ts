import fs from 'fs';
import path from 'path';

export type ApiType = 'direct' | 'json';

export interface ApiConfig {
  id: string;
  url: string;
  type: ApiType;
  jsonPath?: string; // e.g. "data.img_url" for parsing JSON response
}

export interface CategoryConfig {
  apis: ApiConfig[];
}

export const categories: Record<string, CategoryConfig> = {
  pc: {
    apis: [
      // 示例: 一个会进行重定向的API或者返回图片的API
      { id: 'pc-test-direct', url: 'https://api.ixiaowai.cn/gqapi/gqapi.php', type: 'direct' },
      // 示例: 返回 JSON 的 API
      { id: 'pc-test-json', url: 'https://api.waifu.pics/sfw/waifu', type: 'json', jsonPath: 'url' }
    ]
  },
  mobile: {
    apis: [
      { id: 'mobile-test-direct', url: 'https://api.ixiaowai.cn/mcapi/mcapi.php', type: 'direct' }
    ]
  }
};
