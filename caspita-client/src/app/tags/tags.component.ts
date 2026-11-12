import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FeaturesService } from '../services/features.service';
import { FinanceService } from '../services/finance.service';
import { Category } from '../models/finance.model';
import { Transaction } from '../models/bank.model';
import { TAG_COLORS, Tag, TagColor, TagDetail } from '../models/features.model';

@Component({
  selector: 'app-tags',
  templateUrl: './tags.component.html',
  styleUrls: ['./tags.component.scss'],
  standalone: false,
})
export class TagsComponent implements OnInit, OnDestroy {
  tags: Tag[] = [];
  categories: Category[] = [];
  loading = true;
  detail: TagDetail | null = null;
  detailLoading = false;

  newName = '';
  newColor: TagColor = 'pine';
  readonly colors = TAG_COLORS;

  renaming = false;
  renameValue = '';

  private destroy$ = new Subject<void>();

  constructor(
    private features: FeaturesService,
    private finance: FinanceService,
    private route: ActivatedRoute,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    forkJoin({ tags: this.features.tags(), categories: this.finance.getCategories() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ tags, categories }) => {
          this.tags = tags;
          this.categories = categories;
          this.loading = false;
          const id = Number(this.route.snapshot.queryParamMap.get('id'));
          const first = tags.find((t) => t.id === id) ?? tags[0];
          if (first) this.select(first.id);
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('שגיאה בטעינת התגיות', 'סגור', { duration: 4000 });
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refreshList(): void {
    this.features.tags().subscribe({ next: (t) => (this.tags = t), error: () => undefined });
  }

  select(id: number): void {
    this.detailLoading = true;
    this.renaming = false;
    this.router.navigate([], { queryParams: { id }, replaceUrl: true });
    this.features.tag(id).subscribe({
      next: (d) => {
        this.detail = d;
        this.detailLoading = false;
      },
      error: () => {
        this.detailLoading = false;
        this.snackBar.open('שגיאה בטעינת התגית', 'סגור', { duration: 4000 });
      },
    });
  }

  create(): void {
    const name = this.newName.trim();
    if (!name) return;
    this.features.createTag(name, this.newColor).subscribe({
      next: (tag) => {
        this.tags = [tag, ...this.tags];
        this.newName = '';
        this.select(tag.id);
      },
      error: (err: { error?: { error?: string } }) => this.snackBar.open(err.error?.error ?? 'שגיאה ביצירה', 'סגור', { duration: 4000 }),
    });
  }

  setColor(color: TagColor): void {
    if (!this.detail) return;
    const id = this.detail.id;
    this.features.updateTag(id, { color }).subscribe({
      next: () => {
        this.detail = this.detail ? { ...this.detail, color } : null;
        this.tags = this.tags.map((t) => (t.id === id ? { ...t, color } : t));
      },
      error: () => this.snackBar.open('שגיאה בשמירה', 'סגור', { duration: 4000 }),
    });
  }

  startRename(): void {
    this.renaming = true;
    this.renameValue = this.detail?.name ?? '';
  }

  saveRename(): void {
    const name = this.renameValue.trim();
    if (!this.detail || !name) return;
    const id = this.detail.id;
    this.features.updateTag(id, { name }).subscribe({
      next: () => {
        this.renaming = false;
        this.detail = this.detail ? { ...this.detail, name } : null;
        this.tags = this.tags.map((t) => (t.id === id ? { ...t, name } : t));
      },
      error: (err: { error?: { error?: string } }) => this.snackBar.open(err.error?.error ?? 'שגיאה בשמירה', 'סגור', { duration: 4000 }),
    });
  }

  remove(): void {
    if (!this.detail || !confirm(`למחוק את התגית "${this.detail.name}"? העסקאות עצמן לא נמחקות.`)) return;
    const id = this.detail.id;
    this.features.deleteTag(id).subscribe({
      next: () => {
        this.tags = this.tags.filter((t) => t.id !== id);
        this.detail = null;
        if (this.tags[0]) this.select(this.tags[0].id);
      },
      error: () => this.snackBar.open('שגיאה במחיקה', 'סגור', { duration: 4000 }),
    });
  }

  untag(t: Transaction): void {
    if (!this.detail) return;
    const id = this.detail.id;
    this.features.setTransactionTags(t.id, t.tagIds.filter((x) => x !== id)).subscribe({
      next: () => {
        this.select(id);
        this.refreshList();
      },
      error: () => this.snackBar.open('שגיאה בשמירה', 'סגור', { duration: 4000 }),
    });
  }

  categoryName(id: number | null): string {
    return this.categories.find((c) => c.id === id)?.name ?? 'ללא קטגוריה';
  }

  maxCategory(): number {
    return Math.max(1, ...(this.detail?.byCategory ?? []).map((c) => c.amount));
  }

  sortedTransactions(): Transaction[] {
    return [...(this.detail?.transactions ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  }
}
