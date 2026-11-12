import { Component, OnInit, OnDestroy } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TransactionsService } from '../services/transactions.service';
import { SyncService } from '../services/sync.service';
import { FinanceService } from '../services/finance.service';
import { GroupedMerchant, Insight, ScrapeError, TransactionsResult } from '../models/bank.model';
import { Category, monthLabel } from '../models/finance.model';
import { TransactionDetailDialogComponent } from './transaction-detail-dialog/transaction-detail-dialog.component';
import { CashDialogComponent } from './cash-dialog/cash-dialog.component';

type Tab = 'expenses' | 'income';
type CategoryStat = TransactionsResult['byCategory'][number];

const INSIGHT_ICONS: Record<Insight['kind'], string> = {
  deficit: 'trending_down',
  surplus: 'savings',
  pace: 'speed',
  category_up: 'arrow_upward',
  category_down: 'arrow_downward',
  new_merchant: 'fiber_new',
  largest: 'priority_high',
};

@Component({
  selector: 'app-transactions',
  templateUrl: './transactions.component.html',
  styleUrls: ['./transactions.component.scss'],
  standalone: false,
})
export class TransactionsComponent implements OnInit, OnDestroy {
  result: TransactionsResult | null = null;
  merchants: GroupedMerchant[] = [];
  errors: ScrapeError[] = [];
  categories: Category[] = [];
  /** סינון לפי קטגוריה: undefined = הכל, null = ללא קטגוריה */
  categoryFilter: number | null | undefined = undefined;
  tab: Tab = 'expenses';
  showHidden = false;
  /** חיפוש לפי שם ספק / תיאור / הערה */
  search = '';
  showAllCategories = false;
  loading = false;
  selectedMonth: string = this.currentMonth();
  readonly months: string[] = this.buildMonths();

  private destroy$ = new Subject<void>();

  constructor(
    private transactionsService: TransactionsService,
    private finance: FinanceService,
    public sync: SyncService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadCategories();
    this.load();
    this.sync.synced$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.loadCategories();
      this.load(false);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  currentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private buildMonths(): string[] {
    const months: string[] = [];
    const now = new Date();
    for (let i = 0; i < 13; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
  }

  monthLabel(m: string = this.selectedMonth): string {
    return monthLabel(m);
  }

  /** delta=+1 חודש הבא, -1 חודש קודם (הרשימה ממוינת מהחדש לישן) */
  shiftMonth(delta: number): void {
    const idx = this.months.indexOf(this.selectedMonth) - delta;
    if (idx < 0 || idx >= this.months.length) return;
    this.selectedMonth = this.months[idx];
    this.onMonthChange();
  }

  onMonthChange(): void {
    this.categoryFilter = undefined;
    this.search = '';
    this.load();
  }

  loadCategories(): void {
    this.finance.getCategories().pipe(takeUntil(this.destroy$)).subscribe((c) => (this.categories = c));
  }

  load(showSpinner = true): void {
    if (showSpinner) this.loading = true;
    this.transactionsService
      .getGrouped(this.selectedMonth)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.result = result;
          this.merchants = result.merchants;
          this.errors = result.errors;
          this.loading = false;
        },
        error: () => {
          this.snackBar.open('שגיאה בטעינת העסקאות', 'סגור', { duration: 4000 });
          this.loading = false;
        },
      });
  }

  openCash(): void {
    const ref = this.dialog.open(CashDialogComponent, { data: { categories: this.categories }, width: '440px' });
    ref.afterClosed().pipe(takeUntil(this.destroy$)).subscribe((saved: boolean | undefined) => {
      if (saved) this.load(false);
    });
  }

  // ---------- סיכום ----------

  /** שינוי באחוזים מול החודש הקודם (null אם אין עם מה להשוות) */
  changePct(current: number, previous: number): number | null {
    if (!previous) return null;
    return Math.round(((current - previous) / previous) * 100);
  }

  insightIcon(i: Insight): string {
    return INSIGHT_ICONS[i.kind];
  }

  insightTone(i: Insight): 'bad' | 'good' | 'neutral' {
    if (i.kind === 'deficit' || i.kind === 'category_up') return 'bad';
    if (i.kind === 'surplus' || i.kind === 'category_down') return 'good';
    return 'neutral';
  }

  onInsightClick(i: Insight): void {
    if (i.categoryId !== undefined) {
      this.tab = 'expenses';
      this.categoryFilter = i.categoryId;
    } else if (i.merchant) {
      const m = this.merchants.find((x) => x.name === i.merchant);
      if (m) this.openDetail(m);
    }
  }

  // ---------- קטגוריות ----------

  category(id: number | null): Category | undefined {
    return id === null ? undefined : this.categories.find((c) => c.id === id);
  }

  private spentCategories(): CategoryStat[] {
    return (this.result?.byCategory ?? []).filter((c) => c.expenses > 0);
  }

  visibleCategories(): CategoryStat[] {
    const list = this.spentCategories();
    return this.showAllCategories ? list : list.slice(0, 8);
  }

  hiddenCategoryCount(): number {
    return Math.max(0, this.spentCategories().length - 8);
  }

  /** כל הפסים על אותו סולם — כך רואים גם את גודל הקטגוריה וגם את ההשוואה לחודש רגיל */
  private barScale(): number {
    return Math.max(1, ...this.visibleCategories().map((c) => Math.max(c.expenses, c.avgExpenses)));
  }

  barPct(c: CategoryStat): number {
    return (c.expenses / this.barScale()) * 100;
  }

  avgPct(c: CategoryStat): number {
    return (c.avgExpenses / this.barScale()) * 100;
  }

  /** כמה מההכנסות כבר יצא (עד 100% לפס) */
  spentPct(): number {
    const t = this.result?.totals;
    if (!t || t.income <= 0) return 0;
    return Math.min(100, (t.expenses / t.income) * 100);
  }

  spentText(): string {
    const t = this.result?.totals;
    if (!t || t.income <= 0) return '';
    const pct = Math.round((t.expenses / t.income) * 100);
    if (pct > 100) return `ההוצאות גבוהות מההכנסות ב-${pct - 100}%`;
    return `הוצאת ${pct}% ממה שנכנס${this.result?.isCurrentMonth ? ' — הקו מסמן כמה מהחודש עבר' : ''}`;
  }

  overAverage(c: CategoryStat): boolean {
    return c.avgExpenses > 0 && c.expenses > c.avgExpenses * 1.1;
  }

  toggleCategoryFilter(id: number | null): void {
    this.categoryFilter = this.categoryFilter === id ? undefined : id;
    this.tab = 'expenses';
  }

  // ---------- רשימה ----------

  setTab(tab: Tab): void {
    this.tab = tab;
    if (tab === 'income') this.categoryFilter = undefined;
  }

  incomeCount(): number {
    return this.merchants.filter((m) => m.totalAmount > 0).length;
  }

  expenseCount(): number {
    return this.merchants.filter((m) => m.totalAmount < 0).length;
  }

  visibleMerchants(): GroupedMerchant[] {
    let list = this.merchants.filter((m) => (this.tab === 'income' ? m.totalAmount > 0 : m.totalAmount < 0));
    const q = this.search.trim().toLowerCase();
    if (q) {
      list = list.filter((m) => m.name.toLowerCase().includes(q) || m.transactions.some((t) => `${t.description} ${t.memo ?? ''}`.toLowerCase().includes(q)));
    }
    if (this.categoryFilter !== undefined) {
      const filter = this.categoryFilter;
      list = list
        .map((m) => {
          const transactions = m.transactions.filter((t) => t.categoryId === filter);
          return {
            ...m,
            transactions,
            transactionCount: transactions.length,
            totalAmount: transactions.reduce((s, t) => s + t.chargedAmount, 0),
          };
        })
        .filter((m) => m.transactions.length > 0);
    }
    return list;
  }

  openDetail(merchant: GroupedMerchant): void {
    const ref = this.dialog.open(TransactionDetailDialogComponent, {
      data: { merchant, categories: this.categories },
      width: '700px',
      disableClose: true,
    });
    ref.afterClosed().pipe(takeUntil(this.destroy$)).subscribe((changed: boolean | undefined) => {
      if (changed) this.load(false);
    });
  }

  merchantSubtitle(merchant: GroupedMerchant): string {
    const cat = this.category(merchant.categoryId);
    const n = merchant.transactionCount;
    const count = this.tab === 'income' ? `${n} ${n === 1 ? 'זיכוי' : 'זיכויים'}` : `${n} ${n === 1 ? 'חיוב' : 'חיובים'}`;
    const banks = [...new Set(merchant.transactions.map((t) => t.bankName))];
    return [cat?.name ?? 'ללא קטגוריה', count, banks.join(', ')].join(' · ');
  }

  merchantBadge(merchant: GroupedMerchant): string {
    if (merchant.maaserCount) return 'מעשרות';
    if (merchant.transactions.some((t) => t.status === 'pending')) return 'ממתין';
    return '';
  }

  merchantIcon(merchant: GroupedMerchant): string {
    if (merchant.transactions.every((t) => t.accountKind === 'cash')) return 'payments';
    return this.category(merchant.categoryId)?.icon ?? (merchant.maaserCount ? 'volunteer_activism' : 'storefront');
  }

  hiddenLabel(m: GroupedMerchant): string {
    if (m.transactions.every((t) => t.isCardPayment)) return 'תשלום כרטיס — הפירוט מופיע לפי ספק';
    const t = m.transactions[0];
    if (t?.savingsNote) return t.savingsNote;
    if (t?.loanNote) return t.loanNote;
    if (t?.offsetNote && !t.isInternalTransfer) return t.offsetNote;
    if (t?.isLoanCredit) return 'הלוואה או החזר הלוואה — כסף שצריך להחזיר או שחזר, לא הכנסה';
    return t?.maaserNote ?? 'העברה בין החשבונות שלך';
  }
}
