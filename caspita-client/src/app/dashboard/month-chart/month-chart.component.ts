import { Component, Input, OnChanges } from '@angular/core';
import { monthLabel } from '../../models/finance.model';

export interface ChartSeries {
  label: string;
  /** צבע הסדרה (משתנה CSS או hex) */
  color: string;
  values: (number | null)[];
}

/**
 * bars — עמודות מקובצות (סדרה ראשונה מימין בכל חודש)
 * signed — עמודה אחת לחודש, חיובי/שלילי בשני צבעים
 * line — קו אחד, עם אזור עדין עד האפס
 */
export type ChartMode = 'bars' | 'signed' | 'line';

interface Column {
  index: number;
  month: string;
  label: string;
  x: number;
  hitX: number;
  hitW: number;
}

interface BarMark {
  d: string;
  color: string;
  partial: boolean;
}

interface Tick {
  pos: number;
  label: string;
}

const W = 800;
const PAD = { top: 12, bottom: 26, start: 8, end: 54 };

/** גרף חודשי כללי. הזמן זורם מימין לשמאל (הישן מימין), כמו בתחזית. */
@Component({
  selector: 'app-month-chart',
  templateUrl: './month-chart.component.html',
  styleUrls: ['./month-chart.component.scss'],
  standalone: false,
})
export class MonthChartComponent implements OnChanges {
  @Input({ required: true }) months: string[] = [];
  @Input({ required: true }) series: ChartSeries[] = [];
  @Input() mode: ChartMode = 'bars';
  @Input() height = 220;
  /** החודש האחרון עוד לא הסתיים — מסומן חלש יותר */
  @Input() partialLast = false;
  /** צבעי חיובי/שלילי למצב signed */
  @Input() positiveColor = 'var(--chart-income)';
  @Input() negativeColor = 'var(--chart-expense)';
  /** שורה נוספת בטולטיפ לכל חודש */
  @Input() extra: (string | null)[] = [];
  @Input() unit = '₪';
  /** גרף צר — מציגים תווית לכל חודש שני כדי שלא יתנגשו */
  @Input() compact = false;

  readonly W = W;
  plotTop = PAD.top;
  plotLeft = PAD.end;
  plotRight = W - PAD.start;
  plotBottom = 0;
  zeroY = 0;
  columns: Column[] = [];
  bars: BarMark[] = [];
  linePath = '';
  areaPath = '';
  dots: { x: number; y: number }[] = [];
  yTicks: Tick[] = [];
  hovered: Column | null = null;

  ngOnChanges(): void {
    this.build();
  }

  private build(): void {
    const n = this.months.length;
    if (!n) return;
    this.plotBottom = this.height - PAD.bottom;
    const cw = (this.plotRight - this.plotLeft) / n;
    const cx = (i: number) => this.plotRight - (i + 0.5) * cw;

    this.columns = this.months.map((month, i) => ({
      index: i,
      month,
      // החדש ביותר תמיד מסומן; בגרף צר — כל חודש שני ממנו
      label: this.compact && n > 7 && (n - 1 - i) % 2 === 1 ? '' : shortMonth(month, i === 0),
      x: cx(i),
      hitX: this.plotRight - (i + 1) * cw,
      hitW: cw,
    }));

    const values = this.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
    const [lo, hi] = niceRange(Math.min(0, ...values), Math.max(0, ...values));
    const y = (v: number) => this.plotTop + ((hi - v) / (hi - lo || 1)) * (this.plotBottom - this.plotTop);
    this.zeroY = y(0);
    this.yTicks = niceTicks(lo, hi).map((v) => ({ pos: y(v), label: formatShort(v) }));

    this.bars = [];
    this.linePath = '';
    this.areaPath = '';
    this.dots = [];

    if (this.mode === 'line') {
      const s = this.series[0];
      if (!s) return;
      const pts = s.values.map((v, i) => (v === null ? null : { x: cx(i), y: y(v) }));
      let d = '';
      let started = false;
      for (const p of pts) {
        if (!p) { started = false; continue; }
        d += `${started ? 'L' : 'M'}${p.x},${p.y} `;
        started = true;
      }
      this.linePath = d.trim();
      const valid = pts.filter((p): p is { x: number; y: number } => p !== null);
      if (valid.length > 1) {
        this.areaPath = `${this.linePath} L${valid[valid.length - 1].x},${this.zeroY} L${valid[0].x},${this.zeroY} Z`;
      }
      this.dots = valid;
      return;
    }

    const k = this.mode === 'signed' ? 1 : this.series.length;
    const groupW = Math.min(cw * 0.66, k * 22);
    const gap = k > 1 ? 2 : 0;
    const barW = (groupW - gap * (k - 1)) / k;
    this.series.slice(0, k).forEach((s, si) => {
      s.values.forEach((v, i) => {
        if (v === null || v === 0) return;
        // סדרה ראשונה בצד ימין של הקבוצה
        const right = cx(i) + groupW / 2 - si * (barW + gap);
        const color = this.mode === 'signed' ? (v >= 0 ? this.positiveColor : this.negativeColor) : s.color;
        this.bars.push({ d: barPath(right - barW, barW, this.zeroY, y(v)), color, partial: this.partialLast && i === n - 1 });
      });
    });
  }

  colRight(c: Column): number {
    return ((W - c.x) / W) * 100;
  }

  flip(c: Column): boolean {
    return c.x < W * 0.35;
  }

  value(s: ChartSeries, c: Column): number | null {
    return s.values[c.index] ?? null;
  }

  shortName(c: Column): string {
    return shortMonth(c.month, false);
  }

  monthTitle(c: Column): string {
    return monthLabel(c.month) + (this.partialLast && c.index === this.months.length - 1 ? ' (עד היום)' : '');
  }

  dotTop(c: Column): number | null {
    if (this.mode !== 'line') return null;
    const d = this.dots.find((p) => Math.abs(p.x - c.x) < 0.5);
    return d ? (d.y / this.height) * 100 : null;
  }
}

/** עמודה עם פינות מעוגלות רק בקצה הנתון (לא בבסיס) */
function barPath(x: number, w: number, y0: number, y1: number): string {
  const h = Math.abs(y1 - y0);
  const r = Math.min(4, w / 2, h);
  if (y1 < y0) {
    return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
}

const HEB_MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

function shortMonth(month: string, first: boolean): string {
  const [y, m] = month.split('-').map(Number);
  const name = HEB_MONTHS[m - 1];
  return first || m === 1 ? `${name} ${String(y).slice(2)}` : name;
}

function niceStep(span: number): number {
  const raw = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

function niceRange(min: number, max: number): [number, number] {
  const step = niceStep(max - min || 100);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step || step];
}

function niceTicks(lo: number, hi: number): number[] {
  const step = niceStep(hi - lo);
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v));
  return out;
}

function formatShort(v: number): string {
  if (Math.abs(v) >= 1000) return `${Math.round(v / 100) / 10}K`.replace('.0K', 'K');
  return String(v);
}
