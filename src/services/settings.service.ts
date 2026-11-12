import { Setting } from '../models/setting.model';

export interface MaaserSettings {
  /** אחוז המעשר מההכנסה (10 = מעשר, 20 = חומש) */
  percent: number;
  /** החודש שממנו מתחילים לחשב (YYYY-MM). null = מהעסקה הראשונה */
  startMonth: string | null;
  /** יתרת פתיחה: חיובי = חוב מעשרות מלפני תחילת המעקב, שלילי = זכות */
  openingBalance: number;
}

const DEFAULTS: { maaser: MaaserSettings } = {
  maaser: { percent: 10, startMonth: null, openingBalance: 0 },
};

type SettingsMap = typeof DEFAULTS;

async function get<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K]> {
  const row = await Setting.findByPk(key);
  if (!row) return DEFAULTS[key];
  return { ...DEFAULTS[key], ...(JSON.parse(row.value) as Partial<SettingsMap[K]>) };
}

async function set<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): Promise<SettingsMap[K]> {
  await Setting.upsert({ key, value: JSON.stringify(value) });
  return value;
}

export const settingsService = { get, set };
