import { Injectable } from '@angular/core';
import { HttpService } from './http.service';
import { Observable } from 'rxjs';

export interface OtpStatus {
  needed: boolean;
  id?: number;
  bankName?: string;
  attempt?: number;
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

  cancel(id?: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/otp/cancel', { id });
  }
}
