import fs from 'fs';
import os from 'os';
import path from 'path';
import puppeteer from 'puppeteer';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/internal/revisions.js';
import { Browser, install } from '@puppeteer/browsers';

/**
 * Chrome לשליפה מהבנקים. בפיתוח הוא כבר מותקן (postinstall של puppeteer).
 * באפליקציית ווינדוס הוא לא נארז עם ההתקנה (חוסך כ-150MB) ויורד פעם אחת בסנכרון הראשון
 * ל-PUPPETEER_CACHE_DIR (%APPDATA%\Caspita\chrome) — באותה גרסה ש-puppeteer מצפה לה.
 */
let pending: Promise<string> | null = null;

export function ensureChrome(): Promise<string> {
  const executable = puppeteer.executablePath();
  if (fs.existsSync(executable)) return Promise.resolve(executable);
  if (!pending) {
    const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer');
    console.log(`[CHROME] מוריד Chrome ${PUPPETEER_REVISIONS.chrome} ל-${cacheDir} (פעם אחת)`);
    pending = install({ browser: Browser.CHROME, buildId: PUPPETEER_REVISIONS.chrome, cacheDir })
      .then((installed) => {
        console.log('[CHROME] הורד');
        return installed.executablePath;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}
