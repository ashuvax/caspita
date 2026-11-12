import { Component, Input, OnChanges } from '@angular/core';
import { ForecastEvent } from '../../models/finance.model';

interface DayPoint {
  date: string;
  x: number;
  y: number;
  balance: number;
  events: ForecastEvent[];
  hitStart: number;
  hitWidth: number;
}

interface Tick {
  pos: number;
  label: string;
}

const W = 900;
const H = 190;
const PAD = { top: 14, bottom: 26, start: 12, end: 58 };

/** גרף יתרה צפויה לאורך התקופה — קו מדרגות, ציר אפס, אזור המינוס באדום. הזמן זורם מימין לשמאל כמו הטבלה. */
@Component({
  selector: 'app-balance-chart',
  templateUrl: './balance-chart.component.html',
  styleUrls: ['./balance-chart.component.scss'],
  standalone: false,
})
export class BalanceChartComponent implements OnChanges {
  @Input({ required: true }) startBalance = 0;
  @Input({ required: true }) startDate = '';
  @Input({ required: true }) endDate = '';
  @Input() events: ForecastEvent[] = [];

  readonly W = W;
  readonly H = H;
  linePath = '';
  areaPath = '';
  zeroY = 0;
  plotTop = PAD.top;
  plotBottom = H - PAD.bottom;
  plotLeft = PAD.end;
  plotRight = W - PAD.start;
  points: DayPoint[] = [];
  yTicks: Tick[] = [];
  xTicks: Tick[] = [];
  hovered: DayPoint | null = null;
  minPoint: DayPoint | null = null;

  ngOnChanges(): void {
    this.build();
  }

  private dayIndex(d: string): number {
    return Math.round(new Date(d + 'T00:00:00').getTime() / 86400000);
  }

  private build(): void {
    if (!this.startDate || !this.endDate) return;
    const d0 = this.dayIndex(this.startDate);
    const d1 = Math.max(d0 + 1, this.dayIndex(this.endDate));
    const x = (d: string) => this.plotRight - ((this.dayIndex(d) - d0) / (d1 - d0)) * (this.plotRight - this.plotLeft);

    // יתרה בסוף כל יום שיש בו תנועה
    const byDay = new Map<string, ForecastEvent[]>();
    for (const e of this.events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
    const days = [...byDay.keys()].sort();
    const balances = days.map((d) => {
      const list = byDay.get(d) ?? [];
      return list[list.length - 1].balanceAfter;
    });

    const all = [this.startBalance, ...balances, 0];
    const [lo, hi] = niceRange(Math.min(...all), Math.max(...all));
    const y = (v: number) => this.plotTop + ((hi - v) / (hi - lo)) * (this.plotBottom - this.plotTop);
    this.zeroY = y(0);

    // קו מדרגות: יתרה נשארת עד יום התנועה ואז קופצת
    let path = `M${this.plotRight},${y(this.startBalance)}`;
    days.forEach((d, i) => {
      path += ` H${x(d)} V${y(balances[i])}`;
    });
    path += ` H${this.plotLeft}`;
    this.linePath = path;
    this.areaPath = `${path} V${this.zeroY} H${this.plotRight} Z`;

    this.points = days.map((d, i) => ({ date: d, x: x(d), y: y(balances[i]), balance: balances[i], events: byDay.get(d) ?? [], hitStart: 0, hitWidth: 0 }));
    // אזור ריחוף לכל יום: עד אמצע הדרך לשכנים
    this.points.forEach((p, i) => {
      const right = i === 0 ? this.plotRight : (this.points[i - 1].x + p.x) / 2;
      const left = i === this.points.length - 1 ? this.plotLeft : (this.points[i + 1].x + p.x) / 2;
      p.hitStart = left;
      p.hitWidth = Math.max(4, right - left);
    });
    this.minPoint = this.points.length ? this.points.reduce((m, p) => (p.balance < m.balance ? p : m)) : null;

    this.yTicks = niceTicks(lo, hi).map((v) => ({ pos: y(v), label: formatShort(v) }));

    // תחילת כל חודש בטווח
    const ticks: Tick[] = [];
    const start = new Date(this.startDate + 'T00:00:00');
    for (let m = new Date(start.getFullYear(), start.getMonth() + 1, 1); this.dayIndex(isoDate(m)) <= d1; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      ticks.push({ pos: x(isoDate(m)), label: `1/${m.getMonth() + 1}` });
    }
    this.xTicks = ticks;
  }

  /** מיקום הטולטיפ באחוזים מהרוחב (מימין) */
  tipRight(p: DayPoint): number {
    return ((W - p.x) / W) * 100;
  }

  tipFlip(p: DayPoint): boolean {
    return p.x < W * 0.3;
  }
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function niceStep(span: number): number {
  const raw = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

function niceRange(min: number, max: number): [number, number] {
  const step = niceStep(max - min || 1000);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
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
