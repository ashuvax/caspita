import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { GroupedMerchant, MaaserOverride, Transaction } from '../../models/bank.model';
import { FinanceService } from '../../services/finance.service';
import { Category } from '../../models/finance.model';

export interface TransactionDetailData {
  merchant: GroupedMerchant;
  categories: Category[];
}

type OverrideChoice = 'auto' | MaaserOverride;

@Component({
  selector: 'app-transaction-detail-dialog',
  templateUrl: './transaction-detail-dialog.component.html',
  styleUrls: ['./transaction-detail-dialog.component.scss'],
  standalone: false,
})
export class TransactionDetailDialogComponent {
  private changed = false;
  saving = new Set<number>();
  merchant: GroupedMerchant;
  categories: Category[];

  constructor(
    private dialogRef: MatDialogRef<TransactionDetailDialogComponent>,
    private finance: FinanceService,
    private snackBar: MatSnackBar,
    @Inject(MAT_DIALOG_DATA) data: TransactionDetailData
  ) {
    this.merchant = data.merchant;
    this.categories = data.categories;
    dialogRef.backdropClick().subscribe(() => this.close());
    dialogRef.keydownEvents().subscribe((e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  close(): void {
    this.dialogRef.close(this.changed);
  }

  isExpense(txn: Transaction): boolean {
    return txn.chargedAmount < 0;
  }

  absAmount(txn: Transaction): number {
    return Math.abs(txn.chargedAmount);
  }

  netAmount(): number {
    return this.merchant.transactions.reduce((sum, t) => sum + t.chargedAmount, 0);
  }

  choiceOf(txn: Transaction): OverrideChoice {
    return txn.maaserOverride ?? 'auto';
  }

  roleLabel(txn: Transaction): string {
    if (txn.isCardPayment) return 'תשלום כרטיס — לא נספר';
    if (txn.maaserRole === 'donation') return 'נספר כמעשרות';
    if (txn.maaserRole === 'income') return 'הכנסה החייבת במעשר';
    return txn.maaserNote ? `לא נספר — ${txn.maaserNote}` : 'לא נספר';
  }

  includeLabel(txn: Transaction): string {
    return txn.chargedAmount > 0 ? 'הכנסה' : 'מעשר';
  }

  setChoice(txn: Transaction, choice: OverrideChoice): void {
    const override = choice === 'auto' ? null : choice;
    this.saving.add(txn.id);
    this.finance.setMaaserOverride(txn.id, override).subscribe({
      next: () => {
        // עדכון מקומי; התפקיד המדויק (במצב אוטומטי) יחושב בשרת בטעינה הבאה
        txn.maaserOverride = override;
        if (override === 'exclude') txn.maaserRole = null;
        if (override === 'include') txn.maaserRole = txn.chargedAmount > 0 ? 'income' : 'donation';
        this.saving.delete(txn.id);
        this.changed = true;
      },
      error: () => {
        this.saving.delete(txn.id);
        this.snackBar.open('שגיאה בשמירת הסימון', 'סגור', { duration: 4000 });
      },
    });
  }

  setMerchantCategory(categoryId: number | null): void {
    this.finance.setMerchantCategory(this.merchant.name, categoryId).subscribe({
      next: () => {
        // עסקאות שלא נקבעה להן קטגוריה ידנית מקבלות את קטגוריית הספק
        this.merchant = {
          ...this.merchant,
          categoryId,
          transactions: this.merchant.transactions.map((t) => (t.categoryOverridden ? t : { ...t, categoryId })),
        };
        this.changed = true;
      },
      error: () => this.snackBar.open('שגיאה בשמירת הקטגוריה', 'סגור', { duration: 4000 }),
    });
  }

  /** 'merchant' = כמו הספק */
  txnCategoryValue(txn: Transaction): number | 'merchant' | null {
    return txn.categoryOverridden ? txn.categoryId : 'merchant';
  }

  setTransactionCategory(txn: Transaction, value: number | 'merchant' | null): void {
    const categoryId = value === 'merchant' ? null : value;
    // "ללא קטגוריה" לעסקה בודדת לא נתמך כרגע — מחזירים לקטגוריית הספק
    this.finance.setTransactionCategory(txn.id, categoryId).subscribe({
      next: () => {
        this.merchant = {
          ...this.merchant,
          transactions: this.merchant.transactions.map((t) =>
            t.id === txn.id
              ? { ...t, categoryOverridden: categoryId !== null, categoryId: categoryId ?? this.merchant.categoryId }
              : t
          ),
        };
        this.changed = true;
      },
      error: () => this.snackBar.open('שגיאה בשמירת הקטגוריה', 'סגור', { duration: 4000 }),
    });
  }

  categoryName(id: number | null): string {
    return this.categories.find((c) => c.id === id)?.name ?? 'ללא קטגוריה';
  }

  /** תשלום כרטיס / העברה בין חשבונות — לא הוצאה אמיתית, אין טעם בקטגוריה ומעשרות */
  isCounted(txn: Transaction): boolean {
    return !txn.isCardPayment && !txn.isInternalTransfer;
  }

  allHidden(): boolean {
    return this.merchant.transactions.every((t) => !this.isCounted(t));
  }

  deleteCash(txn: Transaction): void {
    if (!confirm('למחוק את עסקת המזומן?')) return;
    this.finance.deleteCash(txn.id).subscribe({
      next: () => {
        const transactions = this.merchant.transactions.filter((t) => t.id !== txn.id);
        this.merchant = { ...this.merchant, transactions, transactionCount: transactions.length };
        this.changed = true;
        if (!transactions.length) this.close();
      },
      error: () => this.snackBar.open('שגיאה במחיקה', 'סגור', { duration: 4000 }),
    });
  }

  addAsDonationPayee(): void {
    this.finance.addMaaserRule('donation', this.merchant.name).subscribe({
      next: () => {
        this.changed = true;
        this.snackBar.open(`"${this.merchant.name}" נוסף לספקי המעשרות — כל תשלום אליו ייספר`, 'סגור', { duration: 4000 });
        this.dialogRef.close(true);
      },
      error: () => this.snackBar.open('שגיאה בהוספת הספק', 'סגור', { duration: 4000 }),
    });
  }

  addAsExcludedIncome(): void {
    this.finance.addMaaserRule('income_exclude', this.merchant.name).subscribe({
      next: () => {
        this.changed = true;
        this.snackBar.open(`הכנסות מ"${this.merchant.name}" לא ייחשבו במעשר`, 'סגור', { duration: 4000 });
        this.dialogRef.close(true);
      },
      error: () => this.snackBar.open('שגיאה בשמירה', 'סגור', { duration: 4000 }),
    });
  }

  hasExpenses(): boolean {
    return this.merchant.transactions.some((t) => t.chargedAmount < 0 && this.isCounted(t));
  }

  hasBankIncome(): boolean {
    return this.merchant.transactions.some((t) => t.chargedAmount > 0 && t.accountKind !== 'card');
  }
}
