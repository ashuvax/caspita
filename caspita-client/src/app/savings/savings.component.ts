import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SavingsService } from '../services/savings.service';
import { SyncService } from '../services/sync.service';
import { SAVINGS_KIND_ICONS, SAVINGS_KIND_LABELS, Savings, SavingsCandidate, SavingsMovement } from '../models/savings.model';
import { SavingsDialogComponent } from './savings-dialog/savings-dialog.component';

interface EntryDraft {
  savingsId: number;
  date: string;
  amount: number | null;
  withdrawal: boolean;
  note: string;
}

@Component({
  selector: 'app-savings',
  templateUrl: './savings.component.html',
  styleUrls: ['./savings.component.scss'],
  standalone: false,
})
export class SavingsComponent implements OnInit, OnDestroy {
  items: Savings[] = [];
  loading = true;
  expanded: number | null = null;
  candidates = new Map<number, SavingsCandidate[]>();
  draft: EntryDraft | null = null;
  confirmDelete: number | null = null;

  readonly kindLabel = SAVINGS_KIND_LABELS;
  readonly kindIcon = SAVINGS_KIND_ICONS;

  private destroy$ = new Subject<void>();

  constructor(
    private savings: SavingsService,
    private sync: SyncService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.load();
    this.sync.synced$.pipe(takeUntil(this.destroy$)).subscribe(() => this.load(false));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(showSpinner = true): void {
    if (showSpinner) this.loading = true;
    this.savings
      .list()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (items) => {
          this.items = items;
          this.candidates = new Map();
          this.loading = false;
          if (this.expanded !== null) this.loadCandidates(this.expanded);
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('שגיאה בטעינת החסכונות', 'סגור', { duration: 4000 });
        },
      });
  }

  totalValue(): number {
    return this.items.reduce((s, i) => s + i.value, 0);
  }

  totalWithdrawable(): number {
    return this.items.reduce((s, i) => s + i.withdrawable, 0);
  }

  totalMonthly(): number {
    return this.items.reduce((s, i) => s + (i.monthlyDeposit ?? 0), 0);
  }

  /** ימים מאז עדכון היתרה — יתרה ישנה מסומנת */
  staleDays(s: Savings): number | null {
    if (!s.balanceDate) return null;
    return Math.round((Date.now() - new Date(s.balanceDate + 'T00:00:00').getTime()) / 86400000);
  }

  liquidNow(s: Savings): boolean {
    return !!s.liquidDate && s.liquidDate <= new Date().toISOString().slice(0, 10);
  }

  openDialog(savings?: Savings): void {
    const ref = this.dialog.open(SavingsDialogComponent, { data: { savings }, width: '540px' });
    ref.afterClosed().pipe(takeUntil(this.destroy$)).subscribe((saved: boolean | undefined) => {
      if (saved) this.load(false);
    });
  }

  toggle(s: Savings): void {
    this.expanded = this.expanded === s.id ? null : s.id;
    this.draft = null;
    this.confirmDelete = null;
    if (this.expanded !== null && !this.candidates.has(s.id)) this.loadCandidates(s.id);
  }

  private loadCandidates(id: number): void {
    this.savings
      .candidates(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe((c) => (this.candidates = new Map([...this.candidates, [id, c]])));
  }

  startEntry(s: Savings, withdrawal: boolean): void {
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    this.draft = { savingsId: s.id, date: iso, amount: null, withdrawal, note: '' };
  }

  saveEntry(): void {
    const d = this.draft;
    if (!d || !d.amount || d.amount <= 0) return;
    this.run(this.savings.addEntry(d.savingsId, { date: d.date, amount: d.withdrawal ? -d.amount : d.amount, note: d.note || null }), 'נרשם');
    this.draft = null;
  }

  link(s: Savings, c: SavingsCandidate): void {
    this.run(this.savings.link(s.id, c.id), 'שויך לחיסכון');
  }

  removeMovement(m: SavingsMovement): void {
    this.run(m.source === 'bank' ? this.savings.unlink(m.id) : this.savings.removeEntry(m.id), m.source === 'bank' ? 'השיוך בוטל' : 'נמחק');
  }

  remove(s: Savings): void {
    if (this.confirmDelete !== s.id) {
      this.confirmDelete = s.id;
      return;
    }
    this.confirmDelete = null;
    this.expanded = null;
    this.run(this.savings.remove(s.id), 'החיסכון נמחק');
  }

  private run(req: Observable<unknown>, message: string): void {
    req.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.snackBar.open(message, 'סגור', { duration: 2500 });
        this.load(false);
      },
      error: () => this.snackBar.open('הפעולה נכשלה', 'סגור', { duration: 4000 }),
    });
  }
}
