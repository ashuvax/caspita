import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

/** תגית חופשית לאירוע / פרויקט ("חתונה", "פסח 2026") — חוצה קטגוריות וחודשים */
export class Tag extends Model<InferAttributes<Tag>, InferCreationAttributes<Tag>> {
  declare id: CreationOptional<number>;
  declare name: string;
  /** אחד מצבעי הממשק (pine, gold, brick, leaf, sky, plum) */
  declare color: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Tag.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    color: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pine' },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, modelName: 'Tag', tableName: 'tags' }
);

export class TransactionTag extends Model<InferAttributes<TransactionTag>, InferCreationAttributes<TransactionTag>> {
  declare id: CreationOptional<number>;
  declare transactionId: number;
  declare tagId: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

TransactionTag.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    transactionId: { type: DataTypes.INTEGER, allowNull: false },
    tagId: { type: DataTypes.INTEGER, allowNull: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'TransactionTag',
    tableName: 'transaction_tags',
    indexes: [{ fields: ['transactionId'] }, { fields: ['tagId'] }, { unique: true, fields: ['transactionId', 'tagId'] }],
  }
);
