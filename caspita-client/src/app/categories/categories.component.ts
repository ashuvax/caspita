import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FinanceService } from '../services/finance.service';
import { SyncService } from '../services/sync.service';
import { Category, CATEGORY_ICONS, MerchantSummary } from '../models/finance.model';

type MerchantFilter = 'unassigned' | 'all' | number;

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

  private destroy$ = new Subject<void>();

  constructor(
    private finance: FinanceService,
    private sync: SyncService,
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
    forkJoin({ categories: this.finance.getCategories(), merchants: this.finance.getCategoryMerchants() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ categories, merchants }) => {
          this.categories = categories;
          this.merchants = merchants;
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
}
