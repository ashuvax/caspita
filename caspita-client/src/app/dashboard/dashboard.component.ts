import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FinanceService } from '../services/finance.service';
import { SyncService } from '../services/sync.service';
import { Category, DashboardCategory, DashboardResult, monthLabel } from '../models/finance.model';
import { ChartSeries } from './month-chart/month-chart.component';

type Range = 6 | 12 | 24;

interface Spark {
  bars: { x: number; y: number; h: number; last: boolean }[];
  typicalY: number | null;
}

const SPARK_W = 120;
const SPARK_H = 36;

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  standalone: false,
})
export class DashboardComponent implements OnInit, OnDestroy {
  result: DashboardResult | null = null;
  categories: Category[] = [];
  loading = true;
  range: Range = 12;

  months: string[] = [];
  flowSeries: ChartSeries[] = [];
  flowExtra: (string | null)[] = [];
  netSeries: ChartSeries[] = [];
  netExtra: (string | null)[] = [];
  balanceSeries: ChartSeries[] = [];
  maaserSeries: ChartSeries[] = [];
  maaserExtra: (string | null)[] = [];
  sparks = new Map<number | null, Spark>();

  readonly SPARK_W = SPARK_W;
  readonly SPARK_H = SPARK_H;

  private destroy$ = new Subject<void>();

  constructor(
    private finance: FinanceService,
    public sync: SyncService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.load();
    this.sync.synced$.pipe(takeUntil(this.destroy$)).subscribe(() => this.load(false));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(showSpinner = true): void {
    if (showSpinner) this.loading = true;
    forkJoin([this.finance.getDashboard(this.range), this.finance.getCategories()])
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ([result, categories]) => {
          this.categories = categories;
          this.apply(result);
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('שגיאה בטעינת הנתונים', 'סגור', { duration: 4000 });
        },
      });
  }

  setRange(r: Range): void {
    this.range = r;
    this.load();
  }

  private apply(r: DashboardResult): void {
    this.result = r;
    const m = r.months;
    this.months = m.map((x) => x.month);
    this.flowSeries = [
      { label: 'נכנס', color: 'var(--chart-income)', values: m.map((x) => x.income) },
      { label: 'יצא', color: 'var(--chart-expense)', values: m.map((x) => x.expenses) },
    ];
    this.flowExtra = m.map((x) => (x.income || x.expenses ? `${x.net >= 0 ? 'נשאר' : 'חסר'} ${fmt(x.net)} ₪` : null));
    this.netSeries = [{ label: 'נשאר בסוף החודש', color: 'var(--chart-income)', values: m.map((x) => (x.income || x.expenses ? x.net : null)) }];
    this.netExtra = m.map((x) => (x.savingsRate !== null ? `${x.savingsRate}% מההכנסות` : null));
    this.balanceSeries = [{ label: 'סך היתרות בבנקים', color: 'var(--pine)', values: m.map((x) => x.balance) }];
    this.maaserSeries = [{ label: 'יתרה לתת', color: 'var(--gold)', values: m.map((x) => x.maaserBalance) }];
    this.maaserExtra = m.map((x) => `חובה ${fmt(x.maaserDue)} · נתת ${fmt(x.maaserPaid)}`);

    this.sparks = new Map(r.categories.map((c) => [c.categoryId, this.spark(c)]));
  }

  private spark(c: DashboardCategory): Spark {
    const n = c.series.length;
    const max = Math.max(1, ...c.series, c.typical);
    const cw = SPARK_W / n;
    const bw = Math.max(2, cw - 2);
    return {
      bars: c.series.map((v, i) => {
        const h = (v / max) * (SPARK_H - 2);
        return { x: SPARK_W - (i + 1) * cw + (cw - bw) / 2, y: SPARK_H - h, h, last: i === n - 2 };
      }),
      typicalY: c.typical > 0 ? SPARK_H - (c.typical / max) * (SPARK_H - 2) : null,
    };
  }

  // ---------- סיכום במילים ----------

  /** בכמה מהחודשים שהסתיימו יצא יותר ממה שנכנס */
  deficitMonths(): { count: number; total: number } {
    const done = (this.result?.months ?? []).filter((x) => !x.partial && (x.income || x.expenses));
    return { count: done.filter((x) => x.net < 0).length, total: done.length };
  }

  lastComplete(c: DashboardCategory): number {
    return c.series[c.series.length - 2] ?? 0;
  }

  categoryName(id: number | null): string {
    return id === null ? 'ללא קטגוריה' : this.categories.find((c) => c.id === id)?.name ?? '';
  }

  categoryIcon(id: number | null): string {
    return id === null ? 'help_outline' : this.categories.find((c) => c.id === id)?.icon ?? 'label';
  }

  trend(c: DashboardCategory): 'up' | 'down' | 'flat' {
    const v = this.lastComplete(c);
    if (c.typical <= 0) return 'flat';
    if (v > c.typical * 1.2 && v - c.typical > 200) return 'up';
    if (v < c.typical * 0.8 && c.typical - v > 200) return 'down';
    return 'flat';
  }

  lastCompleteLabel(): string {
    const m = this.months[this.months.length - 2];
    return m ? monthLabel(m) : '';
  }

  firstMonthLabel(): string {
    return this.months[0] ? monthLabel(this.months[0]) : '';
  }
}

function fmt(n: number): string {
  return Math.round(Math.abs(n)).toLocaleString('he-IL');
}
