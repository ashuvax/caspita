import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

/** donation = ספק שכל תשלום אליו נחשב מעשרות; income_exclude = מקור הכנסה שלא חייב במעשר */
export type MaaserRuleKind = 'donation' | 'income_exclude';

export class MaaserRule extends Model<InferAttributes<MaaserRule>, InferCreationAttributes<MaaserRule>> {
  declare id: CreationOptional<number>;
  declare kind: MaaserRuleKind;
  /** טקסט שמופיע בתיאור העסקה */
  declare pattern: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

MaaserRule.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    kind: { type: DataTypes.STRING(16), allowNull: false },
    pattern: { type: DataTypes.STRING, allowNull: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, modelName: 'MaaserRule', tableName: 'maaser_rules' }
);
