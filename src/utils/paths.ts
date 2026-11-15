import path from 'path';

/**
 * איפה הקוד והקבצים הסטטיים (בניית הלקוח, שרת ה-MCP). בפיתוח — תיקיית הפרויקט;
 * באפליקציית ווינדוס — תיקיית ההתקנה (CASPITA_APP_ROOT, נקבע ב-electron/main.js).
 */
export const APP_ROOT = process.env.CASPITA_APP_ROOT || process.cwd();

/**
 * איפה הנתונים: מסד הנתונים ופרופילי הדפדפן. בפיתוח — תיקיית הפרויקט;
 * באפליקציית ווינדוס — %APPDATA%\Caspita (CASPITA_DATA_DIR).
 */
export const DATA_DIR = process.env.CASPITA_DATA_DIR || process.cwd();

/** פרופיל דפדפן קבוע לכל חיבור — הבנקים זוכרים את המכשיר ולא מבקשים SMS בכל פעם */
export const PROFILES_DIR = path.join(DATA_DIR, 'data', 'browser-profiles');
