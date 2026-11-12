import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

/** include = נספר במעשרות (כהכנסה או כתשלום מעשר לפי הסימן), exclude = לא נספר, null = אוטומטי */
export type MaaserOverride = 'include' | 'exclude';

export class TransactionRecord extends Model<InferAttributes<TransactionRecord>, InferCreationAttributes<TransactionRecord>> {
  declare id: CreationOptional<number>;
  declare hash: string;
  declare bankConfigId: number;
  declare accountId: number;
  /** YYYY-MM-DD לפי שעון ישראל */
  declare date: string;
  declare processedDate: string;
  declare originalAmount: number;
  declare originalCurrency: string;
  declare chargedAmount: number;
  declare chargedCurrency: CreationOptional<string | null>;
  declare description: string;
  declare memo: CreationOptional<string | null>;
  declare type: string;
  declare status: string;
  declare identifier: CreationOptional<string | null>;
  declare installmentNumber: CreationOptional<number | null>;
  declare installmentTotal: CreationOptional<number | null>;
  declare category: CreationOptional<string | null>;
  declare maaserOverride: CreationOptional<MaaserOverride | null>;
  /** בעסקת בנק: מזהה כרטיס האשראי שהחיוב הזה משלם (כדי לא לספור פעמיים) */
  declare cardPaymentForAccountId: CreationOptional<number | null>;
  /** העברה בין חשבונות של המשתמש — לא הכנסה ולא הוצאה */
  declare internalTransfer: CreationOptional<boolean>;
  /** קטגוריה שנקבעה ידנית לעסקה הזו (גוברת על קטגוריית הספק) */
  declare categoryOverrideId: CreationOptional<number | null>;
  declare note: CreationOptional<string | null>;
  /** הלוואה שהעסקה שייכת אליה (קרן או החזר) */
  declare loanId: CreationOptional<number | null>;
  /** חיסכון שהעסקה היא הפקדה/משיכה שלו */
  declare savingsId: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export const transactionNewColumns = {
  internalTransfer: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  categoryOverrideId: { type: DataTypes.INTEGER, allowNull: true },
  loanId: { type: DataTypes.INTEGER, allowNull: true },
  savingsId: { type: DataTypes.INTEGER, allowNull: true },
};

TransactionRecord.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    hash: { type: DataTypes.STRING, allowNull: false, unique: true },
    bankConfigId: { type: DataTypes.INTEGER, allowNull: false },
    accountId: { type: DataTypes.INTEGER, allowNull: false },
    date: { type: DataTypes.STRING(10), allowNull: false },
    processedDate: { type: DataTypes.STRING(10), allowNull: false },
    originalAmount: { type: DataTypes.DOUBLE, allowNull: false },
    originalCurrency: { type: DataTypes.STRING(8), allowNull: false },
    chargedAmount: { type: DataTypes.DOUBLE, allowNull: false },
    chargedCurrency: { type: DataTypes.STRING(8), allowNull: true },
    description: { type: DataTypes.STRING, allowNull: false },
    memo: { type: DataTypes.TEXT, allowNull: true },
    type: { type: DataTypes.STRING(16), allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false },
    identifier: { type: DataTypes.STRING, allowNull: true },
    installmentNumber: { type: DataTypes.INTEGER, allowNull: true },
    installmentTotal: { type: DataTypes.INTEGER, allowNull: true },
    category: { type: DataTypes.STRING, allowNull: true },
    maaserOverride: { type: DataTypes.STRING(8), allowNull: true },
    cardPaymentForAccountId: { type: DataTypes.INTEGER, allowNull: true },
    ...transactionNewColumns,
    note: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'TransactionRecord',
    tableName: 'transactions',
    indexes: [{ fields: ['date'] }, { fields: ['processedDate'] }, { fields: ['accountId'] }],
  }
);
