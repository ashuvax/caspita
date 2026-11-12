import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../utils/db';

/** given = הלוויתי למישהו, taken = לקחתי הלוואה */
export type LoanDirection = 'given' | 'taken';

export class Loan extends Model<InferAttributes<Loan>, InferCreationAttributes<Loan>> {
  declare id: CreationOptional<number>;
  declare direction: LoanDirection;
  /** למי הלוויתי / ממי לקחתי */
  declare counterparty: string;
  /** סכום ההלוואה (חיובי) */
  declare amount: number;
  declare startDate: CreationOptional<string | null>;
  /** מועד ההחזר המוסכם (הלוואה שנתתי) או מועד הסיום (הלוואה שלקחתי) */
  declare dueDate: CreationOptional<string | null>;
  /** יתרה לסילוק לפי הבנק/הגמ"ח — כשידועה (כולל ריבית), גוברת על החישוב */
  declare remainingOverride: CreationOptional<number | null>;
  declare note: CreationOptional<string | null>;
  /** נסגרה ידנית (למשל מחילה, או הוחזרה במזומן בלי רישום) */
  declare closed: CreationOptional<boolean>;
  /** שיוך אוטומטי: תיאור התשלום בבנק (מנורמל) — כל תנועה חדשה כזו משויכת להלוואה בסנכרון */
  declare matchKey: CreationOptional<string | null>;
  /** ובסכום הזה (כשלאותו גוף יש כמה הלוואות עם אותו תיאור) */
  declare matchAmount: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export const loanNewColumns = {
  matchKey: { type: DataTypes.STRING, allowNull: true },
  matchAmount: { type: DataTypes.DOUBLE, allowNull: true },
};

Loan.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    direction: { type: DataTypes.STRING(8), allowNull: false },
    counterparty: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DOUBLE, allowNull: false },
    startDate: { type: DataTypes.STRING(10), allowNull: true },
    dueDate: { type: DataTypes.STRING(10), allowNull: true },
    remainingOverride: { type: DataTypes.DOUBLE, allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
    closed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ...loanNewColumns,
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, modelName: 'Loan', tableName: 'loans' }
);

/** תשלום שלא עבר בבנק (מזומן, צ'ק שלא זוהה) */
export class LoanPayment extends Model<InferAttributes<LoanPayment>, InferCreationAttributes<LoanPayment>> {
  declare id: CreationOptional<number>;
  declare loanId: number;
  declare date: string;
  /** חיובי: כמה הוחזר לי / כמה שילמתי */
  declare amount: number;
  declare note: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

LoanPayment.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    loanId: { type: DataTypes.INTEGER, allowNull: false },
    date: { type: DataTypes.STRING(10), allowNull: false },
    amount: { type: DataTypes.DOUBLE, allowNull: false },
    note: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, modelName: 'LoanPayment', tableName: 'loan_payments', indexes: [{ fields: ['loanId'] }] }
);
