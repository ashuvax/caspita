import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FinanceService } from '../services/finance.service';
import { SyncService } from '../services/sync.service';
import { AccountForecast, ForecastResult } from '../models/finance.model';


@Component({
  selector: 'app-forecast',
  templateUrl: './forecast.component.html',
  styleUrls: ['./forecast.component.scss'],
  standalone: false,
})
export class ForecastComponent implements OnInit, OnDestroy {
  result: ForecastResult | null = null;
  loading = true;

  private destroy$ = new Subject<void>();

  constructor(
    private finance: FinanceService,
    public sync: SyncService,
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

  /** עד סוף החודש הנוכחי — מה שקורה אחרי המשכורת הבאה עוד לא רלוונטי לפעולה */
  private untilDate(): string {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  }

  load(): void {
    this.finance
      .getForecast(this.untilDate())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.result = result;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('שגיאה בחישוב התחזית', 'סגור', { duration: 4000 });
        },
      });
  }

  /** טבלת הפירוט פתוחה כברירת מחדל רק בחשבון שצפוי לרדת למינוס */
  private tableOpen = new Map<number, boolean>();

  isOpen(accountId: number): boolean {
    const acc = this.result?.accounts.find((a) => a.accountId === accountId);
    return this.tableOpen.get(accountId) ?? !!acc?.willGoNegative;
  }

  toggleTable(accountId: number): void {
    this.tableOpen.set(accountId, !this.isOpen(accountId));
  }

  totalDebits(acc: AccountForecast): number {
    return acc.events.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0);
  }

  atRisk(): AccountForecast[] {
    return this.result?.accounts.filter((a) => a.willGoNegative) ?? [];
  }

  /** כמה צריך להעביר לחשבון כדי לא לרדת למינוס */
  shortfall(acc: AccountForecast): number {
    return acc.minBalance !== null && acc.minBalance < 0 ? Math.ceil(-acc.minBalance) : 0;
  }
}
