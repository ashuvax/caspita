import { Component } from '@angular/core';
import { SyncService } from './services/sync.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.scss',
})
export class App {
  navItems: NavItem[] = [
    { path: '/overview', label: 'מה המצב', icon: 'home' },
    { path: '/transactions', label: 'לאן הולך הכסף', icon: 'receipt_long' },
    { path: '/dashboard', label: 'לאורך זמן', icon: 'insights' },
    { path: '/forecast', label: 'תחזית חיובים', icon: 'event_upcoming' },
    { path: '/maaser', label: 'מעשרות', icon: 'volunteer_activism' },
    { path: '/recurring', label: 'הוראות קבע', icon: 'autorenew' },
    { path: '/loans/taken', label: 'הלוואות שלי', icon: 'account_balance_wallet' },
    { path: '/loans/given', label: 'הלוואות שנתתי', icon: 'handshake' },
    { path: '/savings', label: 'חסכונות', icon: 'savings' },
    { path: '/investments', label: 'השקעות', icon: 'show_chart' },
    { path: '/categories', label: 'קטגוריות', icon: 'category' },
    { path: '/banks', label: 'בנקים וכרטיסים', icon: 'account_balance' },
  ];

  constructor(public sync: SyncService) {}

  syncProgress(): string {
    const status = this.sync.status$.value;
    if (!status?.banks.length) return 'מתחבר לבנקים...';
    const done = status.banks.filter((b) => b.state === 'done' || b.state === 'error').length;
    return `${done} מתוך ${status.banks.length} חיבורים`;
  }
}
