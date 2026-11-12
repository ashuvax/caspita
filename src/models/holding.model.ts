import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

/** yahoo = מחיר חי לפי סימול (מניות בארץ ובחו"ל), manual = מחיר שמוזן ידנית (קרנות נאמנות) */
export type PriceSource = 'yahoo' | 'manual';
export type HoldingCurrency = 'ILS' | 'USD';

/** נייר ערך שמוחזק בתיק השקעות */
export class Holding extends Model<InferAttributes<Holding>, InferCreationAttributes<Holding>> {
  declare id: CreationOptional<number>;
  /** איפה מוחזק (פסגות, בנק הפועלים) */
  declare account: string;
  declare name: string;
  /** סימול ב-Yahoo (INTC, POLI.TA) או מספר נייר */
  declare symbol: CreationOptional<string | null>;
  declare quantity: number;
  declare currency: HoldingCurrency;
  declare priceSource: PriceSource;
  /** מחיר ליחידה במטבע הנייר (בשקלים — לא באגורות) */
  declare manualPrice: CreationOptional<number | null>;
  declare manualPriceDate: CreationOptional<string | null>;
  /** עלות כוללת במטבע הנייר — לחישוב רווח/הפסד */
  declare costBasis: CreationOptional<number | null>;
  declare note: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Holding.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    account: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    symbol: { type: DataTypes.STRING, allowNull: true },
    quantity: { type: DataTypes.DOUBLE, allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false },
    priceSource: { type: DataTypes.STRING(8), allowNull: false },
    manualPrice: { type: DataTypes.DOUBLE, allowNull: true },
    manualPriceDate: { type: DataTypes.STRING(10), allowNull: true },
    costBasis: { type: DataTypes.DOUBLE, allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, modelName: 'Holding', tableName: 'holdings' }
);
