import { DataTypes, Model, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

export class Setting extends Model<InferAttributes<Setting>, InferCreationAttributes<Setting>> {
  declare key: string;
  declare value: string;
}

Setting.init(
  {
    key: { type: DataTypes.STRING, primaryKey: true },
    value: { type: DataTypes.TEXT, allowNull: false },
  },
  { sequelize, modelName: 'Setting', tableName: 'settings', timestamps: false }
);
