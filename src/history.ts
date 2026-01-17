import type { NotificationInfo } from './types';

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7日間保持

/**
 * 通知をKVに保存
 */
export async function saveNotification(
  kv: KVNamespace,
  info: NotificationInfo
): Promise<void> {
  const key = buildKey(info);
  await kv.put(key, JSON.stringify(info), {
    expirationTtl: TTL_SECONDS,
  });

  // 重複チェック用のキーも保存
  const duplicateKey = buildDuplicateKey(info);
  await kv.put(duplicateKey, 'exists', {
    expirationTtl: 60 * 5, // 5分間の重複防止
  });
}

/**
 * 重複通知かどうかをチェック
 * 同じワークフロー実行の再通知を防ぐ
 */
export async function isDuplicate(
  kv: KVNamespace,
  info: NotificationInfo
): Promise<boolean> {
  const key = buildDuplicateKey(info);
  const existing = await kv.get(key);
  return existing !== null;
}

/**
 * 最近の通知一覧を取得
 */
export async function getRecentNotifications(
  kv: KVNamespace,
  repositoryName: string,
  limit: number = 10
): Promise<NotificationInfo[]> {
  const prefix = `notification:${repositoryName}:`;
  const list = await kv.list({ prefix, limit });

  const notifications: NotificationInfo[] = [];
  for (const key of list.keys) {
    const value = await kv.get(key.name);
    if (value) {
      notifications.push(JSON.parse(value) as NotificationInfo);
    }
  }

  return notifications;
}

function buildKey(info: NotificationInfo): string {
  const timestamp = Date.now();
  return `notification:${info.repositoryName}:${info.runNumber}:${timestamp}`;
}

function buildDuplicateKey(info: NotificationInfo): string {
  return `duplicate:${info.repositoryName}:${info.runNumber}`;
}
