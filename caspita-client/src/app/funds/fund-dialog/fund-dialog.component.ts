import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FeaturesService } from '../../services/features.service';
import { Fund, FundInput } from '../../models/features.model';
import { Category } from '../../models/finance.model';

export interface FundDialogData {
  fund?: Fund;
  categories: Category[];
}

/** רעיונות מוכנים — מילוי מהיר */
const PRESETS: { name: string; icon: string }[] = [
  { name: 'פסח', icon: 'celebration' },
  { name: 'חגי תשרי', icon: 'synagogue' },
  { name: 'שכר לימוד', icon: 'school' },
  { name: 'ביטוח רכב', icon: 'directions_car' },
  { name: 'מתנות ושמחות', icon: 'redeem' },
  { name: 'חופשה', icon: 'beach_access' },
];

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

@Component({
  selector: 'app-fund-dialog',
  templateUrl: './fund-dialog.component.html',
  styleUrls: ['./fund-dialog.component.scss'],
  standalone: false,
})
export class FundDialogComponent {
  name = '';
  icon = 'savings';
  monthlyAmount: number | null = null;
  targetAmount: number | null = null;
  targetDate = '';
  categoryId: number | null = null;
  startMonth = thisMonth();
  openingBalance: number | null = null;
  note = '';
  saving = false;
  showMore = false;

  readonly presets = PRESETS;
  readonly editing: Fund | undefined;
  readonly categories: Category[];

  constructor(
    private dialogRef: MatDialogRef<FundDialogComponent>,
    private features: FeaturesService,
    private snackBar: MatSnackBar,
    @Inject(MAT_DIALOG_DATA) data: FundDialogData
  ) {
    this.editing = data.fund;
    this.categories = data.categories;
    const f = data.fund;
    if (f) {
      this.name = f.name;
      this.icon = f.icon;
      this.monthlyAmount = f.monthlyAmount;
      this.targetAmount = f.targetAmount;
      this.targetDate = f.targetDate ?? '';
      this.categoryId = f.categoryId;
      this.startMonth = f.startMonth;
      this.openingBalance = f.openingBalance || null;
      this.note = f.note ?? '';
      this.showMore = !!(f.openingBalance || f.note || f.startMonth !== thisMonth());
    }
  }

  usePreset(p: { name: string; icon: string }): void {
    this.name = p.name;
    this.icon = p.icon;
    const cat = this.categories.find((c) => c.name.includes(p.name.split(' ')[0]));
    if (cat && this.categoryId === null) this.categoryId = cat.id;
  }

  /** כמה להפריש בחודש כדי להגיע ליעד בזמן — הצעה */
  suggestedMonthly(): number | null {
    if (!this.targetAmount || !this.targetDate) return null;
    const [ty, tm] = this.targetDate.split('-').map(Number);
    const [sy, sm] = this.startMonth.split('-').map(Number);
    const months = (ty - sy) * 12 + (tm - sm);
    if (months <= 0) return null;
    return Math.ceil((this.targetAmount - (this.openingBalance ?? 0)) / months);
  }

  applySuggestion(): void {
    const s = this.suggestedMonthly();
    if (s !== null && s > 0) this.monthlyAmount = s;
  }

  valid(): boolean {
    return !!this.name.trim() && this.monthlyAmount !== null && this.monthlyAmount >= 0 && /^\d{4}-\d{2}$/.test(this.startMonth);
  }

  save(): void {
    if (!this.valid()) return;
    const input: FundInput = {
      name: this.name.trim(),
      icon: this.icon,
      monthlyAmount: this.monthlyAmount ?? 0,
      targetAmount: this.targetAmount || null,
      targetDate: this.targetDate || null,
      categoryId: this.categoryId,
      startMonth: this.startMonth,
      openingBalance: this.openingBalance ?? 0,
      note: this.note.trim() || null,
    };
    this.saving = true;
    const req = this.editing ? this.features.updateFund(this.editing.id, input) : this.features.createFund(input);
    req.subscribe({
      next: () => this.dialogRef.close(true),
      error: () => {
        this.saving = false;
        this.snackBar.open('שגיאה בשמירה', 'סגור', { duration: 4000 });
      },
    });
  }

  remove(): void {
    if (!this.editing || !confirm(`למחוק את הקופה "${this.editing.name}"? העסקאות עצמן לא נמחקות.`)) return;
    this.features.deleteFund(this.editing.id).subscribe({
      next: () => this.dialogRef.close(true),
      error: () => this.snackBar.open('שגיאה במחיקה', 'סגור', { duration: 4000 }),
    });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
