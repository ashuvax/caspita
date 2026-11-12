import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

export type RecurringSource = 'auto' | 'manual';
export type RecurringStatus = 'active' | 'ignored' | 'ended';
export type RecurringDirection = 'debit' | 'credit';

/** הוראת קבע / חיוב או הכנסה חודשיים קבועים */
export class RecurringItem extends Model<InferAttributes<RecurringItem>, InferCreationAttributes<RecurringItem>> {
  declare id: CreationOptional<number>;
  declare accountId: number;
  /** מפתח מנורמל של תיאור העסקה */
  declare matchKey: string;
  declare displayName: string;
  declare direction: RecurringDirection;
  declare dayOfMonth: number;
  /** סכום צפוי (חיובי), מחושב מההיסטוריה */
  declare expectedAmount: number;
  /** סכום שהמשתמש קבע ידנית — גובר על החישוב */
  declare userAmount: CreationOptional<number | null>;
  declare amountVaries: CreationOptional<boolean>;
  declare source: RecurringSource;
  declare status: RecurringStatus;
  declare occurrences: CreationOptional<number>;
  declare firstSeenDate: CreationOptional<string | null>;
  declare lastSeenDate: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

RecurringItem.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    accountId: { type: DataTypes.INTEGER, allowNull: false },
    matchKey: { type: DataTypes.STRING, allowNull: false },
    displayName: { type: DataTypes.STRING, allowNull: false },
    direction: { type: DataTypes.STRING(8), allowNull: false },
    dayOfMonth: { type: DataTypes.INTEGER, allowNull: false },
    expectedAmount: { type: DataTypes.DOUBLE, allowNull: false },
    userAmount: { type: DataTypes.DOUBLE, allowNull: true },
    amountVaries: { type: DataTypes.BOOLEAN, defaultValue: false },
    source: { type: DataTypes.STRING(8), allowNull: false },
    status: { type: DataTypes.STRING(8), allowNull: false },
    occurrences: { type: DataTypes.INTEGER, defaultValue: 0 },
    firstSeenDate: { type: DataTypes.STRING(10), allowNull: true },
    lastSeenDate: { type: DataTypes.STRING(10), allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'RecurringItem',
    tableName: 'recurring_items',
    indexes: [{ fields: ['accountId', 'matchKey', 'direction'] }],
  }
);
