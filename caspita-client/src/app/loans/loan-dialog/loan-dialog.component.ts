import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { LoansService } from '../../services/loans.service';
import { Loan, LoanDirection, LoanInput } from '../../models/loan.model';

export interface LoanDialogData {
  direction: LoanDirection;
  /** עריכה של הלוואה קיימת */
  loan?: Loan;
  /** מילוי מראש מהצעה (תנועה שזוהתה) */
  prefill?: { counterparty: string; amount: number; date: string; transactionId: number | null; matchDescription?: string; matchAmount?: number | null };
}

@Component({
  selector: 'app-loan-dialog',
  templateUrl: './loan-dialog.component.html',
  styleUrls: ['./loan-dialog.component.scss'],
  standalone: false,
})
export class LoanDialogComponent {
  counterparty = '';
  amount: number | null = null;
  startDate = '';
  dueDate = '';
  remainingOverride: number | null = null;
  note = '';
  /** הלוואה שנתתי: החזר חודשי צפוי — להתראה כשלא נרשם */
  expectedMonthly: number | null = null;
  expectedDay: number | null = null;
  saving = false;

  readonly direction: LoanDirection;
  readonly editing: Loan | undefined;
  private readonly principalTransactionId: number | null;
  private readonly match: { description: string; amount: number | null } | null;

  constructor(
    private dialogRef: MatDialogRef<LoanDialogComponent>,
    private loans: LoansService,
    private snackBar: MatSnackBar,
    @Inject(MAT_DIALOG_DATA) data: LoanDialogData
  ) {
    this.direction = data.direction;
    this.editing = data.loan;
    this.principalTransactionId = data.prefill?.transactionId ?? null;
    this.match = data.prefill?.matchDescription ? { description: data.prefill.matchDescription, amount: data.prefill.matchAmount ?? null } : null;
    const l = data.loan;
    if (l) {
      this.counterparty = l.counterparty;
      this.amount = l.amount;
      this.startDate = l.startDate ?? '';
      this.dueDate = l.dueDate ?? '';
      this.remainingOverride = l.remainingOverride;
      this.note = l.note ?? '';
      this.expectedMonthly = l.expectedMonthly;
      this.expectedDay = l.expectedDay;
    } else if (data.prefill) {
      this.counterparty = data.prefill.counterparty;
      this.amount = data.prefill.amount || null;
      this.startDate = data.prefill.transactionId ? data.prefill.date : '';
    }
  }

  get given(): boolean {
    return this.direction === 'given';
  }

  valid(): boolean {
    return !!this.counterparty.trim() && !!this.amount && this.amount > 0;
  }

  save(): void {
    if (!this.valid()) return;
    this.saving = true;
    const input: LoanInput = {
      counterparty: this.counterparty,
      amount: this.amount ?? 0,
      startDate: this.startDate || null,
      dueDate: this.dueDate || null,
      note: this.note || null,
      remainingOverride: this.given ? null : this.remainingOverride ?? null,
      expectedMonthly: this.given && this.expectedMonthly ? this.expectedMonthly : null,
      expectedDay: this.given && this.expectedMonthly && this.expectedDay ? this.expectedDay : null,
    };
    const req = this.editing
      ? this.loans.update(this.editing.id, input)
      : this.loans.create({
          ...input,
          direction: this.direction,
          principalTransactionId: this.principalTransactionId,
          matchDescription: this.match?.description ?? null,
          matchAmount: this.match?.amount ?? null,
        });
    req.subscribe({
      next: () => {
        this.saving = false;
        this.dialogRef.close(true);
      },
      error: (err: HttpErrorResponse) => {
        this.saving = false;
        this.snackBar.open((err.error as { error?: string } | null)?.error ?? 'שגיאה בשמירה', 'סגור', { duration: 4000 });
      },
    });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
