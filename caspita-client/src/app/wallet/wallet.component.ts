import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FeaturesService } from '../services/features.service';
import { FinanceService } from '../services/finance.service';
import { SyncService } from '../services/sync.service';
import { Category } from '../models/finance.model';
import { WalletSummary, WalletWithdrawal } from '../models/features.model';
import { CashDialogComponent } from '../transactions/cash-dialog/cash-dialog.component';

interface DraftPart {
  categoryId: number | null;
  amount: number | null;
  note: string;
}

@Component({
  selector: 'app-wallet',
  templateUrl: './wallet.component.html',
  styleUrls: ['./wallet.component.scss'],
  standalone: false,
})
export class WalletComponent implements OnInit, OnDestroy {
  summary: WalletSummary | null = null;
  categories: Category[] = [];
  loading = true;
  /** המשיכה שפתוח לה עורך הפירוט */
  editing: number | null = null;
  draft: DraftPart[] = [];
  saving = false;

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
    forkJoin({ summary: this.features.wallet(), categories: this.finance.getCategories() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ summary, categories }) => {
          this.summary = summary;
          this.categories = categories;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('שגיאה בטעינת הארנק', 'סגור', { duration: 4000 });
        },
      });
  }

  addExpense(): void {
    const ref = this.dialog.open(CashDialogComponent, { data: { categories: this.categories }, width: '440px' });
    ref.afterClosed().subscribe((saved: boolean) => {
      if (saved) this.load();
    });
  }

  pct(w: WalletWithdrawal, part: number): number {
    return w.amount ? Math.min(100, (part / w.amount) * 100) : 0;
  }

  categoryName(id: number | null): string {
    return this.categories.find((c) => c.id === id)?.name ?? 'ללא קטגוריה';
  }

  // ---------- פירוט משיכה ----------

  startEdit(w: WalletWithdrawal): void {
    this.editing = w.id;
    this.draft = w.splits.length
      ? w.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount, note: s.note ?? '' }))
      : [{ categoryId: null, amount: null, note: '' }];
  }

  addPart(): void {
    this.draft = [...this.draft, { categoryId: null, amount: null, note: '' }];
  }

  removePart(i: number): void {
    this.draft = this.draft.filter((_, idx) => idx !== i);
  }

  /** כמה אפשר לפרט: המשיכה פחות מה שכבר נרשם כהוצאות מזומן */
  capacity(w: WalletWithdrawal): number {
    return Math.round((w.amount - w.covered) * 100) / 100;
  }

  draftRest(w: WalletWithdrawal): number {
    return Math.round((this.capacity(w) - this.draft.reduce((s, p) => s + (p.amount ?? 0), 0)) * 100) / 100;
  }

  draftValid(w: WalletWithdrawal): boolean {
    const filled = this.draft.filter((p) => p.amount);
    return filled.every((p) => p.categoryId !== null && (p.amount ?? 0) > 0) && this.draftRest(w) >= 0;
  }

  save(w: WalletWithdrawal): void {
    const parts = this.draft
      .filter((p) => p.categoryId !== null && (p.amount ?? 0) > 0)
      .map((p) => ({ categoryId: p.categoryId as number, amount: p.amount as number, note: p.note.trim() || null }));
    this.saving = true;
    this.features.setSplits(w.id, parts).subscribe({
      next: () => {
        this.saving = false;
        this.editing = null;
        this.load();
      },
      error: (err: { error?: { error?: string } }) => {
        this.saving = false;
        this.snackBar.open(err.error?.error ?? 'שגיאה בשמירה', 'סגור', { duration: 4000 });
      },
    });
  }
}
