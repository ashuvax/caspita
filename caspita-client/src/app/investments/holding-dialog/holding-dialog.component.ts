import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { InvestmentsService } from '../../services/investments.service';
import { Holding, HoldingCurrency, HoldingInput, PriceSource } from '../../models/investment.model';

@Component({
  selector: 'app-holding-dialog',
  templateUrl: './holding-dialog.component.html',
  styleUrls: ['./holding-dialog.component.scss'],
  standalone: false,
})
export class HoldingDialogComponent {
  account = '';
  name = '';
  symbol = '';
  quantity: number | null = null;
  currency: HoldingCurrency = 'ILS';
  priceSource: PriceSource = 'yahoo';
  manualPrice: number | null = null;
  costBasis: number | null = null;
  note = '';
  saving = false;
  confirmDelete = false;

  readonly editing: Holding | undefined;
  readonly accounts: string[];

  constructor(
    private dialogRef: MatDialogRef<HoldingDialogComponent>,
    private investments: InvestmentsService,
    private snackBar: MatSnackBar,
    @Inject(MAT_DIALOG_DATA) data: { holding?: Holding; accounts: string[] }
  ) {
    this.editing = data.holding;
    this.accounts = data.accounts;
    const h = data.holding;
    if (h) {
      this.account = h.account;
      this.name = h.name;
      this.symbol = h.symbol ?? '';
      this.quantity = h.quantity;
      this.currency = h.currency;
      this.priceSource = h.priceSource;
      this.manualPrice = h.manualPrice;
      this.costBasis = h.costBasis;
      this.note = h.note ?? '';
    } else if (data.accounts.length) {
      this.account = data.accounts[0];
    }
  }

  valid(): boolean {
    if (!this.account.trim() || !this.name.trim() || !this.quantity || this.quantity <= 0) return false;
    if (this.priceSource === 'yahoo') return !!this.symbol.trim();
    return this.manualPrice !== null && this.manualPrice > 0;
  }

  save(): void {
    if (!this.valid()) return;
    this.saving = true;
    const priceChanged = this.priceSource === 'manual' && this.manualPrice !== (this.editing?.manualPrice ?? null);
    const input: HoldingInput = {
      account: this.account,
      name: this.name,
      symbol: this.symbol || null,
      quantity: this.quantity ?? 0,
      currency: this.currency,
      priceSource: this.priceSource,
      manualPrice: this.manualPrice,
      costBasis: this.costBasis,
      note: this.note || null,
      ...(priceChanged || !this.editing ? { manualPriceDate: this.priceSource === 'manual' ? todayIso() : null } : {}),
    };
    const req = this.editing ? this.investments.update(this.editing.id, input) : this.investments.create(input);
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

  remove(): void {
    if (!this.editing) return;
    if (!this.confirmDelete) {
      this.confirmDelete = true;
      return;
    }
    this.investments.remove(this.editing.id).subscribe({
      next: () => this.dialogRef.close(true),
      error: () => this.snackBar.open('המחיקה נכשלה', 'סגור', { duration: 4000 }),
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
