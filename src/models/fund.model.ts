import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

/**
 * קופה ייעודית להוצאה גדולה צפויה (פסח, חגים, שכר לימוד, ביטוח רכב).
 * כל חודש "מפרישים" סכום קבוע; הוצאות בקטגוריה המשויכת יורדות מהקופה.
 */
export class Fund extends Model<InferAttributes<Fund>, InferCreationAttributes<Fund>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare icon: CreationOptional<string>;
  declare monthlyAmount: number;
  declare targetAmount: CreationOptional<number | null>;
  /** YYYY-MM-DD — מתי צריך את הכסף */
  declare targetDate: CreationOptional<string | null>;
  /** הוצאות בקטגוריה הזו יורדות מהקופה */
  declare categoryId: CreationOptional<number | null>;
  /** YYYY-MM — החודש הראשון שבו מפרישים */
  declare startMonth: string;
  declare openingBalance: CreationOptional<number>;
  declare note: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Fund.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    icon: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'savings' },
    monthlyAmount: { type: DataTypes.DOUBLE, allowNull: false },
    targetAmount: { type: DataTypes.DOUBLE, allowNull: true },
    targetDate: { type: DataTypes.STRING(10), allowNull: true },
    categoryId: { type: DataTypes.INTEGER, allowNull: true },
    startMonth: { type: DataTypes.STRING(7), allowNull: false },
    openingBalance: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    note: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, modelName: 'Fund', tableName: 'funds' }
);
