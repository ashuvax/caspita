import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, forkJoin, of } from 'rxjs';
import { debounceTime, switchMap, takeUntil } from 'rxjs/operators';
import { FinanceService } from '../services/finance.service';
import { FeaturesService } from '../services/features.service';
import { Account } from '../models/bank.model';
import { CategoryRule, CategoryRuleInput, RuleDirection, RulePreview } from '../models/features.model';
import { SyncService } from '../services/sync.service';
import { Category, CATEGORY_ICONS, MerchantSummary } from '../models/finance.model';

type MerchantFilter = 'unassigned' | 'all' | number;

interface RuleForm {
  text: string;
  minAmount: number | null;
  maxAmount: number | null;
  direction: RuleDirection | null;
  accountId: number | null;
  categoryId: number | null;
}

function emptyRule(): RuleForm {
  return { text: '', minAmount: null, maxAmount: null, direction: 'expense', accountId: null, categoryId: null };
}

@Component({
  selector: 'app-categories',
  templateUrl: './categories.component.html',
  styleUrls: ['./categories.component.scss'],
  standalone: false,
})
export class CategoriesComponent implements OnInit, OnDestroy {
  categories: Category[] = [];
  merchants: MerchantSummary[] = [];
  loading = true;
  filter: MerchantFilter = 'unassigned';
  search = '';
  autoRunning = false;

  newName = '';
  newIcon = 'label';
  editingId: number | null = null;
  editName = '';
  editIcon = 'label';
  readonly icons = CATEGORY_ICONS;

  // כללי סיווג
  rules: CategoryRule[] = [];
  accounts: Account[] = [];
  /** null = סגור, 0 = כלל חדש, אחרת עריכת כלל */
  ruleEditing: number | null = null;
  rule: RuleForm = emptyRule();
  preview: RulePreview | null = null;
  ruleSaving = false;
  private preview$ = new Subject<void>();

  private destroy$ = new Subject<void>();

  constructor(
    private features: FeaturesService,
    private finance: FinanceService,
    private sync: SyncService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.load();
    this.preview$
      .pipe(
        debounceTime(350),
        switchMap(() => (this.hasCondition() ? this.features.previewRule(this.ruleInputWithoutCategory()) : of(null))),
        takeUntil(this.destroy$)
      )
      .subscribe({ next: (p) => (this.preview = p), error: () => (this.preview = null) });
    this.sync.synced$.pipe(takeUntil(this.destroy$)).subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    forkJoin({
      categories: this.finance.getCategories(),
      merchants: this.finance.getCategoryMerchants(),
      rules: this.features.rules(),
      accounts: this.finance.getAccounts(),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ categories, merchants, rules, accounts }) => {
          this.categories = categories;
          this.merchants = merchants;
          this.rules = rules;
          this.accounts = accounts.filter((a) => a.kind !== 'cash');
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('שגיאה בטעינת הקטגוריות', 'סגור', { duration: 4000 });
        },
      });
  }

  unassignedCount(): number {
    return this.merchants.filter((m) => m.categoryId === null).length;
  }

  visibleMerchants(): MerchantSummary[] {
    const q = this.search.trim();
    return this.merchants.filter((m) => {
      if (this.filter === 'unassigned' && m.categoryId !== null) return false;
      if (typeof this.filter === 'number' && m.categoryId !== this.filter) return false;
      return !q || m.merchant.includes(q);
    });
  }

  assign(m: MerchantSummary, categoryId: number | null): void {
    this.finance.setMerchantCategory(m.merchant, categoryId).subscribe({
      next: () => {
        const oldId = m.categoryId;
        this.merchants = this.merchants.map((x) => (x.merchant === m.merchant ? { ...x, categoryId } : x));
        this.categories = this.categories.map((c) => ({
          ...c,
          merchantCount: c.merchantCount + (c.id === categoryId ? 1 : 0) - (c.id === oldId ? 1 : 0),
        }));
      },
      error: () => this.snackBar.open('שגיאה בשמירה', 'סגור', { duration: 4000 }),
    });
  }

  autoAssign(): void {
    this.autoRunning = true;
    this.finance.autoAssignCategories().subscribe({
      next: (r) => {
        this.autoRunning = false;
        this.snackBar.open(r.assigned ? `שויכו ${r.assigned} ספקים אוטומטית` : 'לא נמצאו ספקים חדשים לשיוך אוטומטי', 'סגור', { duration: 4000 });
        this.load();
      },
      error: () => {
        this.autoRunning = false;
        this.snackBar.open('שגיאה בשיוך האוטומטי', 'סגור', { duration: 4000 });
      },
    });
  }

  addCategory(): void {
    if (!this.newName.trim()) return;
    this.finance.createCategory(this.newName.trim(), this.newIcon).subscribe({
      next: (categories) => {
        this.categories = categories;
        this.newName = '';
        this.newIcon = 'label';
      },
      error: (err: { error?: { error?: string } }) =>
        this.snackBar.open(err.error?.error ?? 'שגיאה בהוספה', 'סגור', { duration: 4000 }),
    });
  }

  startEdit(c: Category): void {
    this.editingId = c.id;
    this.editName = c.name;
    this.editIcon = c.icon;
  }

  saveEdit(): void {
    if (this.editingId === null || !this.editName.trim()) return;
    this.finance.updateCategory(this.editingId, { name: this.editName.trim(), icon: this.editIcon }).subscribe({
      next: (categories) => {
        this.categories = categories;
        this.editingId = null;
      },
      error: () => this.snackBar.open('שגיאה בשמירה', 'סגור', { duration: 4000 }),
    });
  }

  deleteCategory(c: Category): void {
    if (!confirm(`למחוק את הקטגוריה "${c.name}"? ${c.merchantCount} ספקים יחזרו להיות ללא קטגוריה.`)) return;
    this.finance.deleteCategory(c.id).subscribe({
      next: () => this.load(),
      error: () => this.snackBar.open('שגיאה במחיקה', 'סגור', { duration: 4000 }),
    });
  }

  setBudget(c: Category, event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const value = raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return;
    this.finance.updateCategory(c.id, { monthlyBudget: value }).subscribe({
      next: (categories) => {
        this.categories = categories;
        this.snackBar.open(value ? `תקציב ל${c.name}: ${value.toLocaleString('he-IL')} ₪ בחודש` : `הוסר התקציב של ${c.name}`, 'סגור', { duration: 3000 });
      },
      error: () => this.snackBar.open('שגיאה בשמירת התקציב', 'סגור', { duration: 4000 }),
    });
  }

  blur(event: Event): void {
    (event.target as HTMLInputElement).blur();
  }

  categoryName(id: number): string {
    return this.categories.find((c) => c.id === id)?.name ?? '';
  }

  // ---------- כללי סיווג ----------

  accountName(id: number | null): string {
    const a = this.accounts.find((x) => x.id === id);
    return a ? `${a.bankName} ${a.label || a.accountNumber}` : '';
  }

  /** הכלל במשפט אחד: "תיאור מכיל ברייער · מעל 300 ₪ · הוצאה" */
  describe(r: CategoryRule): string {
    const parts: string[] = [];
    if (r.text) parts.push(`התיאור מכיל "${r.text}"`);
    if (r.minAmount !== null && r.maxAmount !== null) parts.push(`בין ${r.minAmount.toLocaleString('he-IL')} ל-${r.maxAmount.toLocaleString('he-IL')} ₪`);
    else if (r.minAmount !== null) parts.push(`מ-${r.minAmount.toLocaleString('he-IL')} ₪ ומעלה`);
    else if (r.maxAmount !== null) parts.push(`עד ${r.maxAmount.toLocaleString('he-IL')} ₪`);
    if (r.direction) parts.push(r.direction === 'expense' ? 'הוצאה' : 'הכנסה');
    if (r.accountId) parts.push(`ב${this.accountName(r.accountId)}`);
    return parts.join(' · ');
  }

  newRule(): void {
    this.ruleEditing = 0;
    this.rule = emptyRule();
    this.preview = null;
  }

  editRule(r: CategoryRule): void {
    this.ruleEditing = r.id;
    this.rule = { text: r.text ?? '', minAmount: r.minAmount, maxAmount: r.maxAmount, direction: r.direction, accountId: r.accountId, categoryId: r.categoryId };
    this.ruleChanged();
  }

  ruleChanged(): void {
    this.preview$.next();
  }

  hasCondition(): boolean {
    const r = this.rule;
    return !!r.text.trim() || r.minAmount !== null || r.maxAmount !== null || r.accountId !== null;
  }

  private ruleInputWithoutCategory(): Omit<CategoryRuleInput, 'categoryId'> {
    const r = this.rule;
    const num = (v: number | null) => (v === null || (v as unknown) === '' ? null : Number(v));
    return { text: r.text.trim() || null, minAmount: num(r.minAmount), maxAmount: num(r.maxAmount), direction: r.direction, accountId: r.accountId };
  }

  ruleValid(): boolean {
    return this.hasCondition() && this.rule.categoryId !== null;
  }

  saveRule(): void {
    if (!this.ruleValid() || this.ruleEditing === null) return;
    const input: CategoryRuleInput = { ...this.ruleInputWithoutCategory(), categoryId: this.rule.categoryId as number };
    this.ruleSaving = true;
    const req = this.ruleEditing ? this.features.updateRule(this.ruleEditing, input) : this.features.createRule(input);
    req.subscribe({
      next: () => {
        this.ruleSaving = false;
        this.ruleEditing = null;
        this.features.rules().subscribe({ next: (r) => (this.rules = r), error: () => undefined });
        this.snackBar.open('הכלל נשמר — חל גם על עסקאות קודמות', 'סגור', { duration: 3500 });
      },
      error: (err: { error?: { error?: string } }) => {
        this.ruleSaving = false;
        this.snackBar.open(err.error?.error ?? 'שגיאה בשמירת הכלל', 'סגור', { duration: 4000 });
      },
    });
  }

  deleteRule(r: CategoryRule): void {
    if (!confirm('למחוק את הכלל?')) return;
    this.features.deleteRule(r.id).subscribe({
      next: () => (this.rules = this.rules.filter((x) => x.id !== r.id)),
      error: () => this.snackBar.open('שגיאה במחיקה', 'סגור', { duration: 4000 }),
    });
  }
}
