import { Component, Inject, OnDestroy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject, takeUntil } from 'rxjs';
import { OtpChannel, OtpService } from '../../../services/otp.service';

export interface OtpDialogData {
  id?: number;
  bankName: string;
  attempt: number;
  channels: OtpChannel[];
  needsChannel: boolean;
}

const CHANNEL_LABELS: Record<OtpChannel, string> = {
  sms: 'הודעת SMS',
  voice: 'שיחה קולית',
};

@Component({
  selector: 'app-otp-dialog',
  templateUrl: './otp-dialog.component.html',
  styleUrls: ['./otp-dialog.component.scss'],
  standalone: false,
})
export class OtpDialogComponent implements OnDestroy {
  code = '';
  /** הקוד עוד לא נשלח — מחכים שהמשתמש יבחר לאן */
  choosing: boolean;
  sentVia: OtpChannel | null = null;
  sending: OtpChannel | null = null;
  sendFailed = false;
  readonly labels = CHANNEL_LABELS;
  private destroy$ = new Subject<void>();

  constructor(
    private dialogRef: MatDialogRef<OtpDialogComponent>,
    private otpService: OtpService,
    @Inject(MAT_DIALOG_DATA) public data: OtpDialogData
  ) {
    this.choosing = data.needsChannel && data.channels.length > 0;
  }

  get icon(): string {
    return this.sentVia === 'voice' ? 'phone_in_talk' : 'sms';
  }

  get message(): string {
    if (this.choosing) return `לאן ${this.data.bankName} ישלח את קוד האימות?`;
    if (this.sentVia === 'voice') return `${this.data.bankName} יתקשר לטלפון שלך ויקריא את הקוד`;
    if (this.sentVia === 'sms') return `${this.data.bankName} שלח שוב קוד SMS לטלפון שלך`;
    return `${this.data.bankName} שלח קוד SMS לטלפון שלך`;
  }

  /** ערוצים להצעה מתחת לשדה: "לא הגיע? קבל בשיחה קולית" */
  get otherChannels(): OtpChannel[] {
    return this.data.channels.filter((c) => c !== this.sentVia);
  }

  send(channel: OtpChannel): void {
    if (this.sending) return;
    this.sending = channel;
    this.sendFailed = false;
    this.otpService
      .sendVia(channel, this.data.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sending = null;
          if (res.ok) {
            this.sentVia = channel;
            this.choosing = false;
          } else {
            this.sendFailed = true;
          }
        },
        error: () => {
          this.sending = null;
          this.sendFailed = true;
        },
      });
  }

  submit(): void {
    if (this.code.trim() && !this.choosing) {
      this.dialogRef.close(this.code.trim());
    }
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
