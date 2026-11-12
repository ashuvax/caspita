import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

export type AccountKind = 'bank' | 'card' | 'cash';
export type LinkSource = 'auto' | 'manual';

/** חשבון בנק / כרטיס אשראי שהתגלה בסנכרון */
export class Account extends Model<InferAttributes<Account>, InferCreationAttributes<Account>> {
  declare id: CreationOptional<number>;
  declare bankConfigId: number;
  declare accountNumber: string;
  declare kind: AccountKind;
  declare label: CreationOptional<string | null>;
  declare balance: CreationOptional<number | null>;
  declare balanceUpdatedAt: CreationOptional<Date | null>;
  /** לכרטיס אשראי: מאיזה חשבון בנק הוא יורד */
  declare paysFromAccountId: CreationOptional<number | null>;
  declare paysFromSource: CreationOptional<LinkSource | null>;
  /** לכרטיס אשראי: יום החיוב בחודש */
  declare chargeDay: CreationOptional<number | null>;
  declare isHidden: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Account.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    bankConfigId: { type: DataTypes.INTEGER, allowNull: false },
    accountNumber: { type: DataTypes.STRING, allowNull: false },
    kind: { type: DataTypes.STRING(8), allowNull: false },
    label: { type: DataTypes.STRING, allowNull: true },
    balance: { type: DataTypes.DOUBLE, allowNull: true },
    balanceUpdatedAt: { type: DataTypes.DATE, allowNull: true },
    paysFromAccountId: { type: DataTypes.INTEGER, allowNull: true },
    paysFromSource: { type: DataTypes.STRING(8), allowNull: true },
    chargeDay: { type: DataTypes.INTEGER, allowNull: true },
    isHidden: { type: DataTypes.BOOLEAN, defaultValue: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'Account',
    tableName: 'accounts',
    indexes: [{ unique: true, fields: ['bankConfigId', 'accountNumber'] }],
  }
);
