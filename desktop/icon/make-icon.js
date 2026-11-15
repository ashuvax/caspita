// יוצר את icon.ico (ואת ה-favicon של הלקוח) מתוך icon.svg / icon-small.svg.
// הרצה: node desktop/icon/make-icon.js — משתמש ב-Chrome של Puppeteer לרינדור.
// בגדלים הקטנים (עד 32) משתמשים בגרסה בלי הטבעת, כדי שהשקל יהיה קריא.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const SMALL_MAX = 32;

/** ICO עם תמונות PNG (נתמך מ-Windows Vista) */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

async function main() {
  const dir = __dirname;
  const large = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  const small = fs.readFileSync(path.join(dir, 'icon-small.svg'), 'utf8');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const images = [];
  for (const size of SIZES) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const svg = size <= SMALL_MAX ? small : large;
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    const png = await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    images.push({ size, png: Buffer.from(png) });
    if (size === 256) fs.writeFileSync(path.join(dir, 'icon-256.png'), png);
  }
  await browser.close();
  const ico = buildIco(images);
  fs.writeFileSync(path.join(dir, 'icon.ico'), ico);
  fs.writeFileSync(path.join(dir, '..', '..', 'caspita-client', 'public', 'favicon.ico'), buildIco(images.filter((i) => i.size <= 64)));
  console.log(`icon.ico: ${images.length} גדלים, ${ico.length} בתים`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
