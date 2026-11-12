import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FinanceService } from '../services/finance.service';
import { SyncService } from '../services/sync.service';
import { Account } from '../models/bank.model';
import { RecurringInput, RecurringItem, RecurringStatus } from '../models/finance.model';

@Component({
  selector: 'app-recurring',
  templateUrl: './recurring.component.html',
  styleUrls: ['./recurring.component.scss'],
  standalone: false,
})
export class RecurringComponent implements OnInit, OnDestroy {
  items: RecurringItem[] = [];
  bankAccounts: Account[] = [];
  loading = true;
  detecting = false;
  showAdd = false;
  editingId: number | null = null;
  editAmount: number | null = null;
  draft: RecurringInput = this.emptyDraft();

  readonly sections: { status: RecurringStatus; title: string; sub: string }[] = [
    { status: 'active', title: 'פעילות', sub: 'נכללות בתחזית החיובים' },
    { status: 'ended', title: 'הסתיימו', sub: 'לא הופיעו בחודשיים האחרונים — לא נכללות בתחזית' },
    { status: 'ignored', title: 'מוסתרות', sub: 'סימנתם להתעלם מהן' },
  ];

  private destroy$ = new Subject<void>();

  constructor(
    private finance: FinanceService,
    private sync: SyncService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.load();
    this.sync.synced$.pipe(takeUntil(this.destroy$)).subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private emptyDraft(): RecurringInput {
    return { accountId: 0, displayName: '', direction: 'debit', dayOfMonth: 1, amount: 0 };
  }

  load(): void {
    forkJoin({ items: this.finance.getRecurring(), accounts: this.finance.getAccounts() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ items, accounts }) => {
          this.items = items;
          this.bankAccounts = accounts.filter((a) => a.kind === 'bank');
          if (!this.draft.accountId && this.bankAccounts.length) this.draft = { ...this.draft, accountId: this.bankAccounts[0].id };
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('שגיאה בטעינת הוראות הקבע', 'סגור', { duration: 4000 });
        },
      });
  }

  itemsOf(status: RecurringStatus): RecurringItem[] {
    return this.items.filter((i) => i.status === status);
  }

  monthlyTotal(direction: 'debit' | 'credit'): number {
    return this.itemsOf('active')
      .filter((i) => i.direction === direction)
      .reduce((s, i) => s + i.amount, 0);
  }

  detect(): void {
    this.detecting = true;
    this.finance.detectRecurring().subscribe({
      next: (items) => {
        this.items = items;
        this.detecting = false;
        this.snackBar.open('הזיהוי הושלם', 'סגור', { duration: 3000 });
      },
      error: () => {
        this.detecting = false;
        this.snackBar.open('שגיאה בזיהוי', 'סגור', { duration: 4000 });
      },
    });
  }

  setStatus(item: RecurringItem, status: RecurringStatus): void {
    this.finance.updateRecurring(item.id, { status }).subscribe({
      next: () => (this.items = this.items.map((i) => (i.id === item.id ? { ...i, status } : i))),
      error: () => this.snackBar.open('שגיאה בעדכון', 'סגור', { duration: 4000 }),
    });
  }

  startEdit(item: RecurringItem): void {
    this.editingId = item.id;
    this.editAmount = item.amount;
  }

  saveAmount(item: RecurringItem, reset = false): void {
    const userAmount = reset ? null : Number(this.editAmount);
    if (!reset && (!userAmount || userAmount <= 0)) return;
    this.finance.updateRecurring(item.id, { userAmount }).subscribe({
      next: () => {
        this.editingId = null;
        this.items = this.items.map((i) =>
          i.id === item.id ? { ...i, userAmount, amount: userAmount ?? i.expectedAmount } : i
        );
      },
      error: () => this.snackBar.open('שגיאה בשמירת הסכום', 'סגור', { duration: 4000 }),
    });
  }

  remove(item: RecurringItem): void {
    this.finance.deleteRecurring(item.id).subscribe({
      next: () => this.load(),
      error: () => this.snackBar.open('שגיאה במחיקה', 'סגור', { duration: 4000 }),
    });
  }

  addManual(): void {
    const d = this.draft;
    if (!d.accountId || !d.displayName.trim() || !d.amount || d.dayOfMonth < 1 || d.dayOfMonth > 31) {
      this.snackBar.open('יש למלא חשבון, שם, יום וסכום', 'סגור', { duration: 4000 });
      return;
    }
    this.finance.createRecurring({ ...d, amount: Math.abs(Number(d.amount)), dayOfMonth: Number(d.dayOfMonth) }).subscribe({
      next: (items) => {
        this.items = items;
        this.showAdd = false;
        this.draft = { ...this.emptyDraft(), accountId: d.accountId };
      },
      error: () => this.snackBar.open('שגיאה בהוספה', 'סגור', { duration: 4000 }),
    });
  }
}
