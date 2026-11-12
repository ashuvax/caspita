import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

export type RuleDirection = 'expense' | 'income';

/**
 * כלל סיווג: "אם התיאור מכיל X (והסכום בטווח, מהחשבון) ← קטגוריה".
 * גובר על קטגוריית הספק; קטגוריה שנקבעה ידנית לעסקה גוברת עליו.
 */
export class CategoryRule extends Model<InferAttributes<CategoryRule>, InferCreationAttributes<CategoryRule>> {
  declare id: CreationOptional<number>;
  declare categoryId: number;
  /** טקסט שמופיע בתיאור או בהערה של העסקה */
  declare text: CreationOptional<string | null>;
  /** סכום מינימלי/מקסימלי (בערך מוחלט, כולל) */
  declare minAmount: CreationOptional<number | null>;
  declare maxAmount: CreationOptional<number | null>;
  declare direction: CreationOptional<RuleDirection | null>;
  declare accountId: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CategoryRule.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    categoryId: { type: DataTypes.INTEGER, allowNull: false },
    text: { type: DataTypes.STRING, allowNull: true },
    minAmount: { type: DataTypes.DOUBLE, allowNull: true },
    maxAmount: { type: DataTypes.DOUBLE, allowNull: true },
    direction: { type: DataTypes.STRING(8), allowNull: true },
    accountId: { type: DataTypes.INTEGER, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, modelName: 'CategoryRule', tableName: 'category_rules' }
);
