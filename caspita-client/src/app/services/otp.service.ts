import { Injectable } from '@angular/core';
import { HttpService } from './http.service';
import { Observable } from 'rxjs';

/** לאן הבנק שולח את הקוד */
export type OtpChannel = 'sms' | 'voice';

export interface OtpStatus {
  needed: boolean;
  id?: number;
  bankName?: string;
  attempt?: number;
  /** ערוצים שאפשר לבחור (ריק — הבנק לא מציע בחירה) */
  channels?: OtpChannel[];
  /** הקוד עוד לא נשלח — צריך לבחור לאן */
  needsChannel?: boolean;
}

@Injectable({ providedIn: 'root' })
export class OtpService {
  constructor(private http: HttpService) {}

  getStatus(): Observable<OtpStatus> {
    return this.http.get<OtpStatus>('/otp/status');
  }

  submit(code: string, id?: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/otp/submit', { code, id });
  }

  sendVia(channel: OtpChannel, id?: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/otp/send', { channel, id });
  }

  cancel(id?: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/otp/cancel', { id });
  }
}
