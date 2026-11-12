import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FinanceService } from '../../services/finance.service';
import { Category } from '../../models/finance.model';

@Component({
  selector: 'app-cash-dialog',
  templateUrl: './cash-dialog.component.html',
  styleUrls: ['./cash-dialog.component.scss'],
  standalone: false,
})
export class CashDialogComponent {
  direction: 'expense' | 'income' = 'expense';
  amount: number | null = null;
  date: string = new Date().toLocaleDateString('en-CA');
  description = '';
  categoryId: number | null = null;
  note = '';
  saving = false;
  readonly categories: Category[];

  constructor(
    private dialogRef: MatDialogRef<CashDialogComponent>,
    private finance: FinanceService,
    private snackBar: MatSnackBar,
    @Inject(MAT_DIALOG_DATA) data: { categories: Category[] }
  ) {
    this.categories = data.categories;
  }

  valid(): boolean {
    return !!this.amount && this.amount > 0 && !!this.description.trim() && !!this.date;
  }

  save(): void {
    if (!this.valid() || this.amount === null) return;
    this.saving = true;
    const amount = this.direction === 'expense' ? -this.amount : this.amount;
    this.finance
      .addCash({ date: this.date, amount, description: this.description.trim(), categoryId: this.categoryId, note: this.note.trim() || null })
      .subscribe({
        next: () => {
          this.saving = false;
          this.snackBar.open('עסקת המזומן נשמרה', 'סגור', { duration: 3000 });
          this.dialogRef.close(true);
        },
        error: (err: { error?: { error?: string } }) => {
          this.saving = false;
          this.snackBar.open(err.error?.error ?? 'שגיאה בשמירה', 'סגור', { duration: 4000 });
        },
      });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
