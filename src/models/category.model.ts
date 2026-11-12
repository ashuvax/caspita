import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

export class Category extends Model<InferAttributes<Category>, InferCreationAttributes<Category>> {
  declare id: CreationOptional<number>;
  declare name: string;
  /** שם אייקון Material */
  declare icon: CreationOptional<string>;
  declare sortOrder: CreationOptional<number>;
  /** תקציב חודשי (₪). null = בלי תקציב */
  declare monthlyBudget: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export const categoryNewColumns = {
  monthlyBudget: { type: DataTypes.DOUBLE, allowNull: true },
};

Category.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    icon: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'label' },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    ...categoryNewColumns,
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, modelName: 'Category', tableName: 'categories' }
);

/** קטגוריה גלובלית לספק — חלה על כל העסקאות שלו, אלא אם עסקה סומנה אחרת */
export class MerchantCategory extends Model<InferAttributes<MerchantCategory>, InferCreationAttributes<MerchantCategory>> {
  /** שם הספק המנורמל (normalizeText של התיאור) */
  declare merchantKey: string;
  declare categoryId: number;
}

MerchantCategory.init(
  {
    merchantKey: { type: DataTypes.STRING, primaryKey: true },
    categoryId: { type: DataTypes.INTEGER, allowNull: false },
  },
  { sequelize, modelName: 'MerchantCategory', tableName: 'merchant_categories', timestamps: false }
);

export const DEFAULT_CATEGORIES: { name: string; icon: string }[] = [
  { name: 'מזון וסופר', icon: 'shopping_cart' },
  { name: 'מסעדות ובתי קפה', icon: 'restaurant' },
  { name: 'דיור ומשכנתא', icon: 'home' },
  { name: 'חשבונות הבית', icon: 'bolt' },
  { name: 'תקשורת', icon: 'smartphone' },
  { name: 'רכב ותחבורה', icon: 'directions_car' },
  { name: 'דלק', icon: 'local_gas_station' },
  { name: 'ביטוח', icon: 'shield' },
  { name: 'בריאות', icon: 'medical_services' },
  { name: 'חינוך וילדים', icon: 'school' },
  { name: 'ביגוד והנעלה', icon: 'checkroom' },
  { name: 'בית וריהוט', icon: 'chair' },
  { name: 'מעשרות וצדקה', icon: 'volunteer_activism' },
  { name: 'הלוואות וגמ"ח', icon: 'account_balance' },
  { name: 'מתנות ושמחות', icon: 'redeem' },
  { name: 'פנאי ונופש', icon: 'beach_access' },
  { name: 'משכורת', icon: 'payments' },
  { name: 'קצבאות', icon: 'family_restroom' },
  { name: 'עמלות בנק', icon: 'receipt' },
  { name: 'אחר', icon: 'label' },
];
