import { Sequelize } from 'sequelize';
import path from 'path';

/** CASPITA_DB מאפשר מסד נתונים נפרד (למשל מצב הדגמה) */
export const DB_FILE = process.env.CASPITA_DB || 'caspita.db';

export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(process.cwd(), DB_FILE),
  logging: false,
});

/** מצב הדגמה: נתוני דמה, בלי סנכרון אמיתי מול הבנקים */
export const IS_DEMO = process.env.DEMO === 'true';
