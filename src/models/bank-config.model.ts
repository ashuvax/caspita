import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

export class BankConfig extends Model<InferAttributes<BankConfig>, InferCreationAttributes<BankConfig>> {
  declare id: CreationOptional<number>;
  declare companyId: string;
  declare displayName: string;
  declare credentialsEncrypted: string;
  declare isActive: CreationOptional<boolean>;
  declare lastSyncAt: CreationOptional<Date | null>;
  declare lastSyncError: CreationOptional<string | null>;
  /** תאריך (YYYY-MM-DD) שממנו והלאה ההיסטוריה שמורה במלואה */
  declare syncedFrom: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export const bankConfigNewColumns = {
  lastSyncAt: { type: DataTypes.DATE, allowNull: true },
  lastSyncError: { type: DataTypes.TEXT, allowNull: true },
  syncedFrom: { type: DataTypes.STRING(10), allowNull: true },
};

BankConfig.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false },
    displayName: { type: DataTypes.STRING, allowNull: false },
    credentialsEncrypted: { type: DataTypes.TEXT, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    ...bankConfigNewColumns,
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, modelName: 'BankConfig', tableName: 'bank_configs' }
);
