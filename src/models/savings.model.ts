import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

/** gemach_deposit = פיקדון בגמ"ח, study_fund = קרן השתלמות, other = חיסכון אחר */
export type SavingsKind = 'gemach_deposit' | 'study_fund' | 'other';

export class SavingsAccount extends Model<InferAttributes<SavingsAccount>, InferCreationAttributes<SavingsAccount>> {
  declare id: CreationOptional<number>;
  declare kind: SavingsKind;
  declare name: string;
  /** יתרה ידועה (מדוח/אתר הגוף) — מחושבת קדימה עם ההפקדות שאחריה */
  declare balance: CreationOptional<number | null>;
  declare balanceDate: CreationOptional<string | null>;
  /** אחוז שמנוכה במשיכה (פיקדון גמ"ח — 10%) */
  declare penaltyPct: CreationOptional<number | null>;
  /** מתי אפשר למשוך בלי קנס (קרן השתלמות נזילה) */
  declare liquidDate: CreationOptional<string | null>;
  declare note: CreationOptional<string | null>;
  /** שיוך אוטומטי של הפקדות מהבנק: תיאור מנורמל ובסכום (רשות) */
  declare matchKey: CreationOptional<string | null>;
  declare matchAmount: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SavingsAccount.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    kind: { type: DataTypes.STRING(16), allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    balance: { type: DataTypes.DOUBLE, allowNull: true },
    balanceDate: { type: DataTypes.STRING(10), allowNull: true },
    penaltyPct: { type: DataTypes.DOUBLE, allowNull: true },
    liquidDate: { type: DataTypes.STRING(10), allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
    matchKey: { type: DataTypes.STRING, allowNull: true },
    matchAmount: { type: DataTypes.DOUBLE, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, modelName: 'SavingsAccount', tableName: 'savings_accounts' }
);

/** הפקדה/משיכה שלא עברה בבנק (הפקדה מהמשכורת, יתרת פתיחה) */
export class SavingsEntry extends Model<InferAttributes<SavingsEntry>, InferCreationAttributes<SavingsEntry>> {
  declare id: CreationOptional<number>;
  declare savingsId: number;
  declare date: string;
  /** + הפקדה, − משיכה */
  declare amount: number;
  declare note: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SavingsEntry.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    savingsId: { type: DataTypes.INTEGER, allowNull: false },
    date: { type: DataTypes.STRING(10), allowNull: false },
    amount: { type: DataTypes.DOUBLE, allowNull: false },
    note: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, modelName: 'SavingsEntry', tableName: 'savings_entries', indexes: [{ fields: ['savingsId'] }] }
);
