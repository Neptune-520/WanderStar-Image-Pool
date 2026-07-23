import { getCategories, ApiConfig } from './dataManager';

interface ApiState {
  isDisabled: boolean;
  disabledAt?: Date;
  reason?: 'timeout' | 'error';
}

const apiStates: Record<string, ApiState> = {};

export async function syncStore() {
  const categories = await getCategories();
  for (const [catName, category] of Object.entries(categories)) {
    for (const api of category.apis) {
      const key = `${catName}_${api.id}`;
      if (!apiStates[key]) {
        apiStates[key] = { isDisabled: false };
      }
    }
  }
}

export function getApiStates() {
  return apiStates;
}

export async function getAvailableApis(category: string): Promise<ApiConfig[]> {
  await syncStore(); // With caching, this is now O(1)
  const categories = await getCategories();
  const catConfig = categories[category];
  if (!catConfig) return [];
  
  return catConfig.apis.filter(api => {
    if (api.isManuallyBanned) return false;
    const key = `${category}_${api.id}`;
    return !apiStates[key]?.isDisabled;
  });
}

export function disableApi(category: string, id: string, reason: 'timeout' | 'error' = 'error') {
  const key = `${category}_${id}`;
  if (apiStates[key]) {
    apiStates[key].isDisabled = true;
    apiStates[key].disabledAt = new Date();
    apiStates[key].reason = reason;
  }
}

export function enableApi(category: string, id: string) {
  const key = `${category}_${id}`;
  if (apiStates[key] && apiStates[key].isDisabled) {
    apiStates[key].isDisabled = false;
    apiStates[key].disabledAt = undefined;
    apiStates[key].reason = undefined;
    return true;
  }
  return false;
}

export function enableAllApis(categoryName?: string): number {
  let count = 0;
  for (const key in apiStates) {
    if (categoryName && !key.startsWith(`${categoryName}_`)) continue;
    if (apiStates[key].isDisabled) {
      apiStates[key].isDisabled = false;
      apiStates[key].disabledAt = undefined;
      apiStates[key].reason = undefined;
      count++;
    }
  }
  return count;
}
