import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FinanceService } from '../services/finance.service';
import { TransactionsService } from '../services/transactions.service';
import { BanksService } from '../services/banks.service';
import { SyncService } from '../services/sync.service';
import { LoansService } from '../services/loans.service';
import { InvestmentsService } from '../services/investments.service';
import { NetWorth } from '../models/investment.model';
import { Loan } from '../models/loan.model';
import { AccountForecast, ForecastEvent, ForecastResult, MaaserSummary } from '../models/finance.model';
import { BankConfig, TransactionsResult } from '../models/bank.model';

interface Attention {
  icon: string;
  tone: 'bad' | 'warn' | 'info';
  text: string;
  link: string;
  action: string;
}

interface Upcoming extends ForecastEvent {
  accountName: string;
}

/** סנכרון ישן יותר מזה מסומן */
const STALE_SYNC_HOURS = 48;

@Component({
  selector: 'app-overview',
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.scss'],
  standalone: false,
})
export class OverviewComponent implements OnInit, OnDestroy {
  loading = true;
  forecast: ForecastResult | null = null;
  month: TransactionsResult | null = null;
  maaser: MaaserSummary | null = null;
  banks: BankConfig[] = [];
  givenLoans: Loan[] = [];
  netWorth: NetWorth | null = null;

  attention: Attention[] = [];
  upcoming: Upcoming[] = [];
  readonly today = new Date();

  private destroy$ = new Subject<void>();

  constructor(
    private finance: FinanceService,
    private transactions: TransactionsService,
    private banksService: BanksService,
    private loans: LoansService,
    private investments: InvestmentsService,
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
    forkJoin([
      this.finance.getForecast(this.endOfMonth()),
      this.transactions.getGrouped(this.currentMonth()),
      this.finance.getMaaserSummary(),
      this.banksService.getAll(),
      this.loans.list('given'),
      this.investments.netWorth(),
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ([forecast, month, maaser, banks, givenLoans, netWorth]) => {
          this.netWorth = netWorth;
          this.givenLoans = givenLoans;
          this.forecast = forecast;
          this.month = month;
          this.maaser = maaser;
          this.banks = banks;
          this.upcoming = this.buildUpcoming(forecast);
          this.attention = this.buildAttention();
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('שגיאה בטעינת הנתונים', 'סגור', { duration: 4000 });
        },
      });
  }

  // ---------- תאריכים ----------

  private iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private currentMonth(): string {
    return this.iso(this.today).slice(0, 7);
  }

  /** התחזית רק עד סוף החודש — זה מה שאפשר לפעול לגביו עכשיו */
  private endOfMonth(): string {
    return this.iso(new Date(this.today.getFullYear(), this.today.getMonth() + 1, 0));
  }

  // ---------- חשבונות ----------

  totalBalance(): number | null {
    const accs = this.forecast?.accounts.filter((a) => a.balance !== null) ?? [];
    return accs.length ? accs.reduce((s, a) => s + (a.balance ?? 0), 0) : null;
  }

  accountStatus(a: AccountForecast): 'bad' | 'tight' | 'ok' {
    if (a.willGoNegative) return 'bad';
    if (a.minBalance !== null && a.minBalance < 1000) return 'tight';
    return 'ok';
  }

  // ---------- החודש ----------

  changePct(current: number, previous: number): number | null {
    if (!previous) return null;
    return Math.round(((current - previous) / previous) * 100);
  }

  // ---------- יורד בקרוב ----------

  private buildUpcoming(f: ForecastResult): Upcoming[] {
    return f.accounts
      .flatMap((a) => a.events.map((e) => ({ ...e, accountName: a.accountName })))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  upcomingDebits(): number {
    return this.upcoming.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0);
  }

  // ---------- דורש תשומת לב ----------

  private buildAttention(): Attention[] {
    const items: Attention[] = [];
    const fmt = (n: number) => Math.round(Math.abs(n)).toLocaleString('he-IL');

    for (const a of this.forecast?.accounts ?? []) {
      if (!a.willGoNegative || a.minBalance === null || !a.minBalanceDate) continue;
      const [, m, d] = a.minBalanceDate.split('-');
      items.push({
        icon: 'trending_down',
        tone: 'bad',
        text: `${a.accountName} צפוי לרדת למינוס ב-${d}/${m} — חסרים ${fmt(a.minBalance)} ₪`,
        link: '/forecast',
        action: 'לתחזית',
      });
    }

    for (const b of this.banks.filter((x) => x.isActive)) {
      if (b.lastSyncError) {
        items.push({ icon: 'sync_problem', tone: 'bad', text: `הסנכרון האחרון של ${b.displayName} נכשל`, link: '/banks', action: 'לבנקים' });
      } else if (!b.lastSyncAt || Date.now() - new Date(b.lastSyncAt).getTime() > STALE_SYNC_HOURS * 3600_000) {
        items.push({ icon: 'update', tone: 'warn', text: `${b.displayName} לא סונכרן ביומיים האחרונים — הנתונים עלולים להיות חסרים`, link: '/banks', action: 'לבנקים' });
      }
    }

    const late = (this.forecast?.accounts ?? []).flatMap((a) => a.events.filter((e) => e.late));
    if (late.length) {
      items.push({
        icon: 'schedule',
        tone: 'warn',
        text: late.length === 1 ? `${late[0].label} עוד לא ירד (באיחור)` : `${late.length} חיובים קבועים באיחור — עוד לא ירדו`,
        link: '/forecast',
        action: 'לתחזית',
      });
    }

    for (const l of this.givenLoans) {
      if (l.status === 'overdue') {
        items.push({ icon: 'handshake', tone: 'warn', text: `${l.counterparty} היה אמור להחזיר ${fmt(l.remaining)} ₪ — באיחור`, link: '/loans/given', action: 'להלוואות' });
      } else if (l.status === 'open' && l.daysFromDue !== null && l.daysFromDue >= -7) {
        items.push({ icon: 'handshake', tone: 'info', text: `${l.counterparty} אמור להחזיר ${fmt(l.remaining)} ₪ ${l.daysFromDue === 0 ? 'היום' : `בעוד ${-l.daysFromDue} ימים`}`, link: '/loans/given', action: 'להלוואות' });
      }
    }

    if (this.forecast?.unlinkedCards.length) {
      items.push({ icon: 'link_off', tone: 'warn', text: `לא ידוע מאיזה חשבון יורד: ${this.forecast.unlinkedCards.join(', ')}`, link: '/banks', action: 'לקשר' });
    }

    const unassigned = this.month?.byCategory.find((c) => c.categoryId === null);
    if (unassigned && unassigned.expenses > 0) {
      const count = this.month?.merchants.filter((m) => m.totalAmount < 0 && m.categoryId === null).length ?? 0;
      items.push({
        icon: 'label_off',
        tone: 'info',
        text: `${fmt(unassigned.expenses)} ₪ מההוצאות החודש בלי קטגוריה (${count} ספקים)`,
        link: '/categories',
        action: 'לשייך',
      });
    }

    if (this.maaser && this.maaser.totals.balance > 0) {
      items.push({ icon: 'volunteer_activism', tone: 'info', text: `נשארו ${fmt(this.maaser.totals.balance)} ₪ מעשרות לתת`, link: '/maaser', action: 'למעשרות' });
    }

    const order = { bad: 0, warn: 1, info: 2 };
    return items.sort((a, b) => order[a.tone] - order[b.tone]);
  }

  maaserThisMonth(): { due: number; paid: number } {
    const m = this.maaser?.months.find((x) => x.month === this.currentMonth());
    return { due: m?.due ?? 0, paid: m?.paid ?? 0 };
  }
}
