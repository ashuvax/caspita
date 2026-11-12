import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HttpService } from './http.service';
import { HoldingInput, InvestmentsResult, NetWorth } from '../models/investment.model';

@Injectable({ providedIn: 'root' })
export class InvestmentsService {
  constructor(private http: HttpService) {}

  list(refresh = false): Observable<InvestmentsResult> {
    return this.http.get<InvestmentsResult>('/investments', refresh ? { refresh: '1' } : undefined);
  }

  create(input: HoldingInput): Observable<InvestmentsResult> {
    return this.http.post<InvestmentsResult>('/investments', input);
  }

  update(id: number, input: HoldingInput): Observable<InvestmentsResult> {
    return this.http.put<InvestmentsResult>(`/investments/${id}`, input);
  }

  remove(id: number): Observable<void> {
    return this.http.delete<void>(`/investments/${id}`);
  }

  netWorth(): Observable<NetWorth> {
    return this.http.get<NetWorth>('/networth');
  }
}
