import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { SavingsService } from '../../services/savings.service';
import { SAVINGS_KIND_LABELS, Savings, SavingsInput, SavingsKind } from '../../models/savings.model';

@Component({
  selector: 'app-savings-dialog',
  templateUrl: './savings-dialog.component.html',
  styleUrls: ['./savings-dialog.component.scss'],
  standalone: false,
})
export class SavingsDialogComponent {
  kind: SavingsKind = 'study_fund';
  name = '';
  balance: number | null = null;
  balanceDate = '';
  penaltyPct: number | null = null;
  liquidDate = '';
  note = '';
  saving = false;

  readonly kinds = Object.entries(SAVINGS_KIND_LABELS) as [SavingsKind, string][];
  readonly editing: Savings | undefined;

  constructor(
    private dialogRef: MatDialogRef<SavingsDialogComponent>,
    private savings: SavingsService,
    private snackBar: MatSnackBar,
    @Inject(MAT_DIALOG_DATA) data: { savings?: Savings }
  ) {
    this.editing = data.savings;
    const s = data.savings;
    if (s) {
      this.kind = s.kind;
      this.name = s.name;
      this.balance = s.balance;
      this.balanceDate = s.balanceDate ?? '';
      this.penaltyPct = s.penaltyPct;
      this.liquidDate = s.liquidDate ?? '';
      this.note = s.note ?? '';
    } else {
      this.balanceDate = todayIso();
    }
  }

  onKindChange(): void {
    if (this.kind === 'gemach_deposit' && this.penaltyPct === null) this.penaltyPct = 10;
  }

  valid(): boolean {
    return !!this.name.trim();
  }

  save(): void {
    if (!this.valid()) return;
    this.saving = true;
    const input: SavingsInput = {
      kind: this.kind,
      name: this.name,
      balance: this.balance ?? null,
      balanceDate: this.balance !== null ? this.balanceDate || todayIso() : null,
      penaltyPct: this.penaltyPct ?? null,
      liquidDate: this.liquidDate || null,
      note: this.note || null,
    };
    const req = this.editing ? this.savings.update(this.editing.id, input) : this.savings.create(input);
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

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
