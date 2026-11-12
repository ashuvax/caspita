import { sequelize } from '../utils/db';
import { ensureColumns } from '../utils/migrate';
import { BankConfig, bankConfigNewColumns } from './bank-config.model';
import { Account } from './account.model';
import { TransactionRecord, transactionNewColumns } from './transaction.model';
import { MaaserRule } from './maaser-rule.model';
import { RecurringItem } from './recurring-item.model';
import { Setting } from './setting.model';
import { Category, MerchantCategory } from './category.model';
import { Loan, LoanPayment, loanNewColumns } from './loan.model';
import { SavingsAccount, SavingsEntry } from './savings.model';
import { Holding } from './holding.model';

export async function initDatabase(): Promise<void> {
  await sequelize.authenticate();
  await BankConfig.sync();
  await ensureColumns('bank_configs', bankConfigNewColumns);
  await Account.sync();
  await TransactionRecord.sync();
  await ensureColumns('transactions', transactionNewColumns);
  await MaaserRule.sync();
  await RecurringItem.sync();
  await Setting.sync();
  await Category.sync();
  await MerchantCategory.sync();
  await Loan.sync();
  await ensureColumns('loans', loanNewColumns);
  await LoanPayment.sync();
  await SavingsAccount.sync();
  await SavingsEntry.sync();
  await Holding.sync();
  // טבלת המטמון הישנה הוחלפה בטבלת עסקאות קבועה
  await sequelize.getQueryInterface().dropTable('transaction_cache');
}

export { BankConfig, Account, TransactionRecord, MaaserRule, RecurringItem, Setting, Category, MerchantCategory, Loan, LoanPayment, SavingsAccount, SavingsEntry, Holding };
