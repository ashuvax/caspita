import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { LoansService } from '../services/loans.service';
import { SyncService } from '../services/sync.service';
import { Loan, LoanCandidate, LoanDirection, LoanEntry, LoanSuggestion } from '../models/loan.model';
import { LoanDialogComponent, LoanDialogData } from './loan-dialog/loan-dialog.component';

interface PaymentDraft {
  date: string;
  amount: number | null;
  note: string;
}

@Component({
  selector: 'app-loans',
  templateUrl: './loans.component.html',
  styleUrls: ['./loans.component.scss'],
  standalone: false,
})
export class LoansComponent implements OnInit, OnDestroy {
  direction: LoanDirection = 'given';
  loans: Loan[] = [];
  suggestions: LoanSuggestion[] = [];
  loading = true;
  showRepaid = false;

  /** הלוואה פתוחה לפרטים */
  expanded: number | null = null;
  candidates = new Map<number, LoanCandidate[]>();
  payment: { loanId: number; draft: PaymentDraft } | null = null;
  confirmDelete: number | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private loansService: LoansService,
    private sync: SyncService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.direction = this.route.snapshot.data['direction'] === 'taken' ? 'taken' : 'given';
    this.load();
    this.sync.synced$.pipe(takeUntil(this.destroy$)).subscribe(() => this.load(false));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get given(): boolean {
    return this.direction === 'given';
  }

  load(showSpinner = true): void {
    if (showSpinner) this.loading = true;
    forkJoin([this.loansService.list(this.direction), this.loansService.suggestions(this.direction)])
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ([loans, suggestions]) => {
          this.loans = loans;
          this.suggestions = suggestions;
          this.candidates = new Map();
          this.loading = false;
          if (this.expanded !== null) this.loadCandidates(this.expanded);
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('שגיאה בטעינת ההלוואות', 'סגור', { duration: 4000 });
        },
      });
  }

  // ---------- סיכום ----------

  active(): Loan[] {
    return this.loans.filter((l) => l.status !== 'repaid');
  }

  repaid(): Loan[] {
    return this.loans.filter((l) => l.status === 'repaid');
  }

  totalRemaining(): number {
    return this.active().reduce((s, l) => s + l.remaining, 0);
  }

  overdue(): Loan[] {
    return this.loans.filter((l) => l.status === 'overdue');
  }

  overdueRemaining(): number {
    return this.overdue().reduce((s, l) => s + l.remaining, 0);
  }

  totalMonthly(): number {
    return this.active().reduce((s, l) => s + (l.monthlyPayment ?? 0), 0);
  }

  paidPct(l: Loan): number {
    const base = l.paid + l.remaining;
    return base > 0 ? Math.min(100, (l.paid / base) * 100) : 100;
  }

  statusText(l: Loan): string {
    if (l.status === 'repaid') return l.closed ? 'נסגרה' : this.given ? 'הוחזרה' : 'שולמה';
    if (l.daysFromDue === null) return 'בלי מועד';
    if (l.status === 'overdue') return l.daysFromDue >= 60 ? `באיחור של ${Math.round(l.daysFromDue / 30)} חודשים` : `באיחור של ${l.daysFromDue} ימים`;
    if (l.daysFromDue === 0) return 'היום';
    return `בעוד ${-l.daysFromDue} ימים`;
  }

  // ---------- פעולות ----------

  openDialog(data: Partial<LoanDialogData> = {}): void {
    const ref = this.dialog.open(LoanDialogComponent, { data: { direction: this.direction, ...data }, width: '520px' });
    ref.afterClosed().pipe(takeUntil(this.destroy$)).subscribe((saved: boolean | undefined) => {
      if (saved) this.load(false);
    });
  }

  fromSuggestion(s: LoanSuggestion): void {
    this.openDialog({
      prefill: { counterparty: s.counterparty, amount: s.amount, date: s.date, transactionId: s.transactionId, matchDescription: s.matchDescription, matchAmount: s.monthly },
    });
  }

  toggle(l: Loan): void {
    this.expanded = this.expanded === l.id ? null : l.id;
    this.payment = null;
    this.confirmDelete = null;
    if (this.expanded !== null && !this.candidates.has(l.id)) this.loadCandidates(l.id);
  }

  private loadCandidates(id: number): void {
    this.loansService
      .candidates(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe((c) => (this.candidates = new Map([...this.candidates, [id, c]])));
  }

  link(l: Loan, c: LoanCandidate): void {
    this.run(this.loansService.link(l.id, c.id), 'שויך להלוואה');
  }

  removeEntry(e: LoanEntry): void {
    this.run(e.source === 'bank' ? this.loansService.unlink(e.id) : this.loansService.removePayment(e.id), e.source === 'bank' ? 'השיוך בוטל' : 'התשלום נמחק');
  }

  startPayment(l: Loan): void {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    this.payment = { loanId: l.id, draft: { date: iso, amount: l.remaining || null, note: '' } };
  }

  savePayment(): void {
    const p = this.payment;
    if (!p || !p.draft.amount || p.draft.amount <= 0) return;
    this.run(this.loansService.addPayment(p.loanId, { date: p.draft.date, amount: p.draft.amount, note: p.draft.note || null }), 'נרשם');
    this.payment = null;
  }

  setClosed(l: Loan, closed: boolean): void {
    this.run(this.loansService.update(l.id, { closed }), closed ? 'ההלוואה סומנה כסגורה' : 'ההלוואה נפתחה מחדש');
  }

  remove(l: Loan): void {
    if (this.confirmDelete !== l.id) {
      this.confirmDelete = l.id;
      return;
    }
    this.confirmDelete = null;
    this.expanded = null;
    this.run(this.loansService.remove(l.id), 'ההלוואה נמחקה');
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

  entryLabel(e: LoanEntry): string {
    if (e.kind === 'principal') return this.given ? 'ההלוואה' : 'קיבלת';
    return this.given ? 'החזר' : 'תשלום';
  }
}
