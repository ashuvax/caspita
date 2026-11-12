import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FeaturesService } from '../services/features.service';
import { FinanceService } from '../services/finance.service';
import { SyncService } from '../services/sync.service';
import { Fund } from '../models/features.model';
import { Category } from '../models/finance.model';
import { FundDialogComponent } from './fund-dialog/fund-dialog.component';

@Component({
  selector: 'app-funds',
  templateUrl: './funds.component.html',
  styleUrls: ['./funds.component.scss'],
  standalone: false,
})
export class FundsComponent implements OnInit, OnDestroy {
  funds: Fund[] = [];
  categories: Category[] = [];
  loading = true;

  private destroy$ = new Subject<void>();

  constructor(
    private features: FeaturesService,
    private finance: FinanceService,
    private sync: SyncService,
    private dialog: MatDialog,
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

  load(): void {
    forkJoin({ funds: this.features.funds(), categories: this.finance.getCategories() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ funds, categories }) => {
          this.funds = funds;
          this.categories = categories;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('שגיאה בטעינת הקופות', 'סגור', { duration: 4000 });
        },
      });
  }

  total(): number {
    return this.funds.reduce((s, f) => s + Math.max(0, f.balance), 0);
  }

  monthlyTotal(): number {
    return this.funds.reduce((s, f) => s + f.monthlyAmount, 0);
  }

  categoryName(id: number | null): string | null {
    return id === null ? null : this.categories.find((c) => c.id === id)?.name ?? null;
  }

  progressPct(f: Fund): number {
    if (!f.targetAmount) return 0;
    return Math.max(0, Math.min(100, (f.balance / f.targetAmount) * 100));
  }

  open(fund?: Fund): void {
    const ref = this.dialog.open(FundDialogComponent, { data: { fund, categories: this.categories }, width: '520px' });
    ref.afterClosed().pipe(takeUntil(this.destroy$)).subscribe((saved: boolean | undefined) => {
      if (saved) this.load();
    });
  }
}
