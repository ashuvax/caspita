import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FinanceService } from '../services/finance.service';
import { SyncService } from '../services/sync.service';
import { MaaserRule, MaaserRuleKind, MaaserSettings, MaaserSummary } from '../models/finance.model';

@Component({
  selector: 'app-maaser',
  templateUrl: './maaser.component.html',
  styleUrls: ['./maaser.component.scss'],
  standalone: false,
})
export class MaaserComponent implements OnInit, OnDestroy {
  summary: MaaserSummary | null = null;
  rules: MaaserRule[] = [];
  loading = true;
  savingSettings = false;

  newDonation = '';
  newExclude = '';
  settingsForm: MaaserSettings = { percent: 10, startMonth: null, openingBalance: 0 };

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

  load(): void {
    forkJoin({ summary: this.finance.getMaaserSummary(), rules: this.finance.getMaaserRules() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ summary, rules }) => {
          this.summary = summary;
          this.rules = rules;
          this.settingsForm = { ...summary.settings };
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('שגיאה בטעינת המעשרות', 'סגור', { duration: 4000 });
        },
      });
  }

  rulesOf(kind: MaaserRuleKind): MaaserRule[] {
    return this.rules.filter((r) => r.kind === kind);
  }

  addRule(kind: MaaserRuleKind): void {
    const pattern = (kind === 'donation' ? this.newDonation : this.newExclude).trim();
    if (!pattern) return;
    this.finance.addMaaserRule(kind, pattern).subscribe({
      next: () => {
        if (kind === 'donation') this.newDonation = '';
        else this.newExclude = '';
        this.load();
      },
      error: () => this.snackBar.open('שגיאה בהוספה', 'סגור', { duration: 4000 }),
    });
  }

  removeRule(rule: MaaserRule): void {
    this.finance.deleteMaaserRule(rule.id).subscribe({
      next: () => this.load(),
      error: () => this.snackBar.open('שגיאה במחיקה', 'סגור', { duration: 4000 }),
    });
  }

  saveSettings(): void {
    this.savingSettings = true;
    this.finance
      .updateMaaserSettings({
        percent: Number(this.settingsForm.percent),
        startMonth: this.settingsForm.startMonth || null,
        openingBalance: Number(this.settingsForm.openingBalance) || 0,
      })
      .subscribe({
        next: () => {
          this.savingSettings = false;
          this.snackBar.open('ההגדרות נשמרו', 'סגור', { duration: 3000 });
          this.load();
        },
        error: () => {
          this.savingSettings = false;
          this.snackBar.open('שגיאה בשמירת ההגדרות', 'סגור', { duration: 4000 });
        },
      });
  }

  currentMonthRow() {
    return this.summary?.months[0] ?? null;
  }

  balanceLabel(balance: number): string {
    if (Math.abs(balance) < 0.5) return 'מאוזן';
    return balance > 0 ? 'נשאר לתת' : 'נתת מעבר (זכות)';
  }
}
