import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FeaturesService } from '../services/features.service';
import { FinanceService } from '../services/finance.service';
import { Category } from '../models/finance.model';
import { YearSummary } from '../models/features.model';

@Component({
  selector: 'app-year',
  templateUrl: './year.component.html',
  styleUrls: ['./year.component.scss'],
  standalone: false,
})
export class YearComponent implements OnInit, OnDestroy {
  summary: YearSummary | null = null;
  categories: Category[] = [];
  loading = true;
  year = new Date().getFullYear();
  years: number[] = [new Date().getFullYear()];

  private destroy$ = new Subject<void>();

  constructor(
    private features: FeaturesService,
    private finance: FinanceService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.finance.getCategories().pipe(takeUntil(this.destroy$)).subscribe({ next: (c) => (this.categories = c), error: () => undefined });
    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.loading = true;
    forkJoin({ summary: this.features.year(this.year) })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ summary }) => {
          this.summary = summary;
          const first = summary.firstDate ? Number(summary.firstDate.slice(0, 4)) : this.year;
          const now = new Date().getFullYear();
          this.years = Array.from({ length: now - first + 1 }, (_, i) => now - i);
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('שגיאה בטעינת הסיכום', 'סגור', { duration: 4000 });
        },
      });
  }

  setYear(y: number): void {
    this.year = y;
    this.load();
  }

  print(): void {
    window.print();
  }

  categoryName(id: number | null): string {
    return this.categories.find((c) => c.id === id)?.name ?? 'ללא קטגוריה';
  }

  maxMonth(): number {
    return Math.max(1, ...(this.summary?.months ?? []).flatMap((m) => [m.income, m.expenses]));
  }

  maxCategory(): number {
    return Math.max(1, ...(this.summary?.byCategory ?? []).map((c) => c.amount));
  }

  topCategories(): YearSummary['byCategory'] {
    return (this.summary?.byCategory ?? []).slice(0, 12);
  }

  /** שינוי באחוזים מול אותה תקופה בשנה שעברה */
  change(cur: number, prev: number | null): number | null {
    if (prev === null || prev <= 0) return null;
    return Math.round(((cur - prev) / prev) * 100);
  }

  savingsRate(): number | null {
    const s = this.summary;
    if (!s || s.totals.income <= 0) return null;
    return Math.round((s.totals.net / s.totals.income) * 100);
  }
}
