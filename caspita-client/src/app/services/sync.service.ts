import { Injectable, NgZone } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, Subject, Subscription, interval } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';
import { HttpService } from './http.service';
import { OtpService } from './otp.service';
import { SyncStatus } from '../models/finance.model';
import { ScrapeError } from '../models/bank.model';
import { OtpDialogComponent } from '../shared/components/otp-dialog/otp-dialog.component';

/**
 * סנכרון מול הבנקים: מתחיל ברקע בשרת, ועוקב כל 2 שניות אחרי הסטטוס ואחרי בקשות לקוד SMS.
 * עמודים נרשמים ל-synced$ כדי לטעון מחדש כשהסנכרון מסתיים.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  readonly status$ = new BehaviorSubject<SyncStatus | null>(null);
  readonly synced$ = new Subject<ScrapeError[]>();

  private poll?: Subscription;
  private otpDialogOpen = false;

  constructor(
    private http: HttpService,
    private otpService: OtpService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private zone: NgZone
  ) {
    // אם סנכרון כבר רץ בשרת (למשל אחרי רענון הדף) — ממשיכים לעקוב
    this.http.get<SyncStatus>('/sync/status').subscribe({
      next: (status) => {
        this.status$.next(status);
        if (status.running) this.startPolling();
      },
      error: () => undefined,
    });
  }

  get running(): boolean {
    return this.status$.value?.running ?? false;
  }

  sync(): void {
    if (this.running) return;
    this.http.post<SyncStatus>('/sync', {}).subscribe({
      next: (status) => {
        this.status$.next(status);
        this.startPolling();
      },
      error: () => this.snackBar.open('שגיאה בהפעלת הסנכרון', 'סגור', { duration: 4000 }),
    });
  }

  private startPolling(): void {
    this.poll?.unsubscribe();
    this.poll = interval(2000)
      .pipe(switchMap(() => this.http.get<SyncStatus>('/sync/status')))
      .subscribe((status) => {
        this.status$.next(status);
        this.checkOtp();
        if (!status.running) this.finish(status);
      });
  }

  private finish(status: SyncStatus): void {
    this.poll?.unsubscribe();
    this.poll = undefined;
    const errors: ScrapeError[] = status.banks
      .filter((b) => b.state === 'error')
      .map((b) => ({ bankId: b.bankId, displayName: b.displayName, error: b.error ?? '' }));
    const added = status.banks.reduce((s, b) => s + (b.added ?? 0), 0);
    if (errors.length) {
      this.snackBar.open(`הסנכרון הסתיים עם שגיאות ב-${errors.length} חיבורים`, 'סגור', { duration: 6000 });
    } else {
      this.snackBar.open(added ? `הסנכרון הסתיים — ${added} עסקאות חדשות` : 'הסנכרון הסתיים — אין עסקאות חדשות', 'סגור', { duration: 4000 });
    }
    this.synced$.next(errors);
  }

  private checkOtp(): void {
    if (this.otpDialogOpen) return;
    this.otpService.getStatus().subscribe((otp) => {
      if (!otp.needed || this.otpDialogOpen) return;
      this.otpDialogOpen = true;
      this.zone.run(() => {
        const ref = this.dialog.open(OtpDialogComponent, {
          data: { bankName: otp.bankName ?? '', attempt: otp.attempt ?? 1 },
          disableClose: true,
          width: '380px',
        });
        ref.afterClosed().pipe(take(1)).subscribe((code: string | null) => {
          this.otpDialogOpen = false;
          if (code) this.otpService.submit(code, otp.id).subscribe();
          else this.otpService.cancel(otp.id).subscribe();
        });
      });
    });
  }
}
