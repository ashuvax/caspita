import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SyncService } from './services/sync.service';
import { FeaturesService } from './services/features.service';
import { AppAlert } from './models/features.model';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

interface NavGroup {
  title: string | null;
  items: NavItem[];
}

/** רענון ההתראות ברקע */
const ALERTS_REFRESH_MS = 10 * 60 * 1000;

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.scss',
})
export class App implements OnInit, OnDestroy {
  navGroups: NavGroup[] = [
    {
      title: null,
      items: [
        { path: '/overview', label: 'מה המצב', icon: 'home' },
        { path: '/assistant', label: 'שאל את כספיטה', icon: 'forum' },
      ],
    },
    {
      title: 'החודש',
      items: [
        { path: '/transactions', label: 'לאן הולך הכסף', icon: 'receipt_long' },
        { path: '/forecast', label: 'תחזית חיובים', icon: 'event_upcoming' },
        { path: '/installments', label: 'תשלומים', icon: 'view_week' },
        { path: '/recurring', label: 'הוראות קבע', icon: 'autorenew' },
      ],
    },
    {
      title: 'תכנון',
      items: [
        { path: '/funds', label: 'קופות', icon: 'savings' },
        { path: '/dashboard', label: 'לאורך זמן', icon: 'insights' },
        { path: '/maaser', label: 'מעשרות', icon: 'volunteer_activism' },
      ],
    },
    {
      title: 'נכסים וחובות',
      items: [
        { path: '/savings', label: 'חסכונות', icon: 'account_balance_wallet' },
        { path: '/investments', label: 'השקעות', icon: 'show_chart' },
        { path: '/loans/taken', label: 'הלוואות שלי', icon: 'request_quote' },
        { path: '/loans/given', label: 'הלוואות שנתתי', icon: 'handshake' },
      ],
    },
    {
      title: 'הגדרות',
      items: [
        { path: '/categories', label: 'קטגוריות ותקציב', icon: 'category' },
        { path: '/banks', label: 'בנקים וכרטיסים', icon: 'account_balance' },
      ],
    },
  ];

  private destroy$ = new Subject<void>();

  constructor(
    public sync: SyncService,
    public features: FeaturesService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.features.refreshAlerts();
    this.sync.synced$.pipe(takeUntil(this.destroy$)).subscribe(() => this.features.refreshAlerts());
    interval(ALERTS_REFRESH_MS).pipe(takeUntil(this.destroy$)).subscribe(() => this.features.refreshAlerts());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  syncProgress(): string {
    const status = this.sync.status$.value;
    if (!status?.banks.length) return 'מתחבר לבנקים...';
    const done = status.banks.filter((b) => b.state === 'done' || b.state === 'error').length;
    return `${done} מתוך ${status.banks.length} חיבורים`;
  }

  alertIcon(a: AppAlert): string {
    if (a.kind === 'price_down') return 'trending_down';
    if (a.kind === 'price_up') return 'trending_up';
    if (a.kind === 'budget') return 'speed';
    if (a.kind === 'installment_done') return 'celebration';
    return 'schedule';
  }

  openAlert(a: AppAlert): void {
    this.router.navigateByUrl(a.link);
  }

  dismiss(a: AppAlert, event: Event): void {
    event.stopPropagation();
    this.features.dismissAlert(a.key).subscribe();
  }
}
