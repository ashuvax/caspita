import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { InvestmentsService } from '../services/investments.service';
import { Holding, InvestmentsResult } from '../models/investment.model';
import { HoldingDialogComponent } from './holding-dialog/holding-dialog.component';

interface AccountGroup {
  account: string;
  holdings: Holding[];
  totalIls: number;
  dayChangeIls: number;
}

/** כל כמה זמן מרעננים מחירים כשהמסך פתוח */
const REFRESH_MS = 60_000;

@Component({
  selector: 'app-investments',
  templateUrl: './investments.component.html',
  styleUrls: ['./investments.component.scss'],
  standalone: false,
})
export class InvestmentsComponent implements OnInit, OnDestroy {
  result: InvestmentsResult | null = null;
  groups: AccountGroup[] = [];
  loading = true;
  refreshing = false;

  private destroy$ = new Subject<void>();

  constructor(
    private investments: InvestmentsService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.load();
    interval(REFRESH_MS).pipe(takeUntil(this.destroy$)).subscribe(() => this.load(false));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(showSpinner = true, force = false): void {
    if (showSpinner) this.loading = true;
    if (force) this.refreshing = true;
    this.investments
      .list(force)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (r) => {
          this.apply(r);
          this.loading = false;
          this.refreshing = false;
        },
        error: () => {
          this.loading = false;
          this.refreshing = false;
          this.snackBar.open('שגיאה בטעינת ההשקעות', 'סגור', { duration: 4000 });
        },
      });
  }

  private apply(r: InvestmentsResult): void {
    this.result = r;
    const byAccount = new Map<string, Holding[]>();
    for (const h of r.holdings) byAccount.set(h.account, [...(byAccount.get(h.account) ?? []), h]);
    this.groups = [...byAccount.entries()]
      .map(([account, holdings]) => ({
        account,
        holdings: [...holdings].sort((a, b) => (b.valueIls ?? 0) - (a.valueIls ?? 0)),
        totalIls: holdings.reduce((s, h) => s + (h.valueIls ?? 0), 0),
        dayChangeIls: holdings.reduce((s, h) => s + (h.dayChangeIls ?? 0), 0),
      }))
      .sort((a, b) => b.totalIls - a.totalIls);
  }

  openDialog(holding?: Holding): void {
    const ref = this.dialog.open(HoldingDialogComponent, { data: { holding, accounts: this.groups.map((g) => g.account) }, width: '540px' });
    ref.afterClosed().pipe(takeUntil(this.destroy$)).subscribe((saved: boolean | undefined) => {
      if (saved) this.load(false);
    });
  }

  currencySign(h: Holding): string {
    return h.currency === 'USD' ? '$' : '₪';
  }

  /** מחיר ידני ישן — כדאי לעדכן */
  manualStaleDays(h: Holding): number | null {
    if (h.priceSource !== 'manual' || !h.manualPriceDate) return null;
    return Math.round((Date.now() - new Date(h.manualPriceDate + 'T00:00:00').getTime()) / 86400000);
  }
}
