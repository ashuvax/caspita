import { DataTypes, type ModelAttributeColumnOptions } from 'sequelize';
import { sequelize } from './db';

type ColumnSpec = Record<string, ModelAttributeColumnOptions>;

/** מוסיף עמודות חסרות לטבלה קיימת בלי לגעת בנתונים (SQLite לא תומך ב-alter בטוח) */
export async function ensureColumns(table: string, columns: ColumnSpec): Promise<void> {
  const qi = sequelize.getQueryInterface();
  const existing = await qi.describeTable(table);
  for (const [name, spec] of Object.entries(columns)) {
    if (!(name in existing)) {
      await qi.addColumn(table, name, spec);
      console.log(`[DB] נוספה עמודה ${table}.${name}`);
    }
  }
}

export { DataTypes };
