import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

/** חלק מעסקה ששייך לקטגוריה אחרת (קנייה אחת: ספרים + ביגוד). השארית נשארת בקטגוריה של העסקה */
export class TransactionSplit extends Model<InferAttributes<TransactionSplit>, InferCreationAttributes<TransactionSplit>> {
  declare id: CreationOptional<number>;
  declare transactionId: number;
  declare categoryId: number;
  /** סכום חיובי — החלק מתוך העסקה */
  declare amount: number;
  /** על מה (למשל בפירוט משיכת מזומן: "ירקות בשוק") */
  declare note: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export const splitNewColumns = {
  note: { type: DataTypes.TEXT, allowNull: true },
};

TransactionSplit.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    transactionId: { type: DataTypes.INTEGER, allowNull: false },
    categoryId: { type: DataTypes.INTEGER, allowNull: false },
    amount: { type: DataTypes.DOUBLE, allowNull: false },
    ...splitNewColumns,
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, modelName: 'TransactionSplit', tableName: 'transaction_splits', indexes: [{ fields: ['transactionId'] }] }
);
