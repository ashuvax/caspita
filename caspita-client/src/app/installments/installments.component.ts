import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FeaturesService } from '../services/features.service';
import { SyncService } from '../services/sync.service';
import { InstallmentPlan, InstallmentsResult } from '../models/features.model';
import { LoanDirection } from '../models/loan.model';

@Component({
  selector: 'app-installments',
  templateUrl: './installments.component.html',
  styleUrls: ['./installments.component.scss'],
  standalone: false,
})
export class InstallmentsComponent implements OnInit, OnDestroy {
  result: InstallmentsResult | null = null;
  loading = true;
  /** העסקה שפתוח לה טופס "זו הלוואה" */
  loanFormKey: string | null = null;
  loanDirection: LoanDirection = 'given';
  loanName = '';
  saving = false;

  private destroy$ = new Subject<void>();

  constructor(
    private features: FeaturesService,
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

  load(): void {
    this.features
      .installments()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (r) => {
          this.result = r;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('שגיאה בטעינת התשלומים', 'סגור', { duration: 4000 });
        },
      });
  }

  active(): InstallmentPlan[] {
    return (this.result?.plans ?? []).filter((p) => !p.done);
  }

  done(): InstallmentPlan[] {
    return (this.result?.plans ?? []).filter((p) => p.done);
  }

  progressPct(p: InstallmentPlan): number {
    return (p.paidPayments / p.totalPayments) * 100;
  }

  maxUpcoming(): number {
    return Math.max(1, ...(this.result?.upcoming ?? []).map((u) => u.amount));
  }

  openLoanForm(p: InstallmentPlan): void {
    this.loanFormKey = this.loanFormKey === p.key ? null : p.key;
    this.loanDirection = 'given';
    this.loanName = '';
  }

  saveLoan(p: InstallmentPlan): void {
    if (!this.loanName.trim()) return;
    this.saving = true;
    this.features.markInstallmentLoan({ key: p.key, direction: this.loanDirection, counterparty: this.loanName.trim() }).subscribe({
      next: () => {
        this.saving = false;
        this.loanFormKey = null;
        this.snackBar.open(
          this.loanDirection === 'given'
            ? 'נרשם כהלוואה שנתת — התשלומים כבר לא נספרים כהוצאה'
            : 'נרשם כהלוואה שלקחת — מופיע ב"הלוואות שלי"',
          'סגור',
          { duration: 5000 }
        );
        this.load();
      },
      error: () => {
        this.saving = false;
        this.snackBar.open('שגיאה בשמירה', 'סגור', { duration: 4000 });
      },
    });
  }
}
