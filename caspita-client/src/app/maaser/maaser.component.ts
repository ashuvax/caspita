import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FinanceService } from '../services/finance.service';
import { SyncService } from '../services/sync.service';
import { MaaserRule, MaaserRuleKind, MaaserSettings, MaaserSummary } from '../models/finance.model';
import { FeaturesService } from '../services/features.service';
import { DonationEntryStatus, DonationPreview, DonationPreviewEntry, Section46Payee, Section46Summary } from '../models/features.model';

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
  s46: Section46Summary | null = null;
  s46Year = new Date().getFullYear();
  readonly s46Years = [0, 1, 2].map((i) => new Date().getFullYear() - i);
  // ייבוא דוח תרומות
  importing = false;
  importPreview: DonationPreview | null = null;
  importMarkPayees = false;
  showMatched = false;

  private destroy$ = new Subject<void>();

  constructor(
    private finance: FinanceService,
    private features: FeaturesService,
    private sync: SyncService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.load();
    this.loadS46();
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

  loadS46(): void {
    this.features
      .section46(this.s46Year)
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (s) => (this.s46 = s), error: () => undefined });
  }

  toggleS46(p: Section46Payee, eligible: boolean): void {
    this.features.setSection46Payee(p.name, eligible, this.s46Year).subscribe({
      next: () => this.loadS46(),
      error: () => this.snackBar.open('שגיאה בשמירה', 'סגור', { duration: 4000 }),
    });
  }

  // ---------- ייבוא דוח תרומות ----------

  onReportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importing = true;
    this.features.previewDonations(file).subscribe({
      next: (p) => {
        this.importing = false;
        this.importPreview = p;
        this.showMatched = false;
        if (p.year && p.year !== this.s46Year && this.s46Years.includes(p.year)) {
          this.s46Year = p.year;
          this.loadS46();
        }
      },
      error: (err: { error?: { error?: string } }) => {
        this.importing = false;
        this.snackBar.open(err.error?.error ?? 'שגיאה בקריאת הקובץ', 'סגור', { duration: 5000 });
      },
    });
  }

  importOf(status: DonationEntryStatus): DonationPreviewEntry[] {
    return (this.importPreview?.entries ?? []).filter((e) => e.status === status);
  }

  importCount(): number {
    const p = this.importPreview;
    return p ? p.counts.matched + p.counts.cash_new : 0;
  }

  applyImport(): void {
    const p = this.importPreview;
    if (!p) return;
    const entries = p.entries.filter((e) => e.status !== 'unmatched');
    this.importing = true;
    this.features.applyDonations(entries, this.importMarkPayees).subscribe({
      next: (r) => {
        this.importing = false;
        this.importPreview = null;
        const parts = [`${r.marked} תרומות סומנו כמזכות`];
        if (r.created) parts.push(`נוספו ${r.created} תרומות במזומן`);
        this.snackBar.open(parts.join(' · '), 'סגור', { duration: 5000 });
        this.loadS46();
        this.load();
      },
      error: () => {
        this.importing = false;
        this.snackBar.open('שגיאה בשמירה', 'סגור', { duration: 4000 });
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
