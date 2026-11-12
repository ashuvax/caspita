import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { initDatabase } from './models';
import { router } from './routes/index.router';
import { errorHandler } from './utils/http';
import { maaserService } from './services/maaser.service';
import { categoriesService } from './services/categories.service';
import { IS_DEMO, DB_FILE } from './utils/db';
import { seedDemo } from './demo/seed';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api', router);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'נתיב לא קיים' });
});
app.use(errorHandler);

const clientDist = path.join(process.cwd(), 'caspita-client', 'dist', 'caspita-client', 'browser');
app.use(express.static(clientDist));
app.use((_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

async function bootstrap(): Promise<void> {
  await initDatabase();
  await maaserService.ensureDefaultRules();
  await categoriesService.ensureDefaults();
  if (IS_DEMO) await seedDemo(process.env.DEMO_RESET === 'true');
  console.log(`Database ready (${DB_FILE}${IS_DEMO ? ', מצב הדגמה' : ''})`);
  // ברירת מחדל: רק מהמחשב הזה (הפרטים כאן רגישים)
  const host = process.env.HOST || '127.0.0.1';
  app.listen(Number(PORT), host, () => {
    console.log(`Caspita server running on http://${host === '0.0.0.0' ? 'localhost' : host}:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
