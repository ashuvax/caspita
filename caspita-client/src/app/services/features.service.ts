import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { HttpService } from './http.service';
import { Loan } from '../models/loan.model';
import {
  AppAlert,
  AssistantAnswer,
  AssistantEngine,
  AssistantTurn,
  Fund,
  FundInput,
  InstallmentLoanInput,
  InstallmentsResult,
  Section46Summary,
} from '../models/features.model';

@Injectable({ providedIn: 'root' })
export class FeaturesService {
  /** ההתראות הפתוחות — משותף לפעמון ולמסך הבית */
  readonly alerts$ = new BehaviorSubject<AppAlert[]>([]);

  constructor(private http: HttpService) {}

  // פיצול עסקה
  setSplits(transactionId: number, parts: { categoryId: number; amount: number }[]): Observable<void> {
    return this.http.put<void>(`/transactions/${transactionId}/splits`, { parts });
  }

  // תשלומים
  installments(): Observable<InstallmentsResult> {
    return this.http.get<InstallmentsResult>('/installments');
  }

  markInstallmentLoan(input: InstallmentLoanInput): Observable<Loan> {
    return this.http.post<Loan>('/installments/loan', input);
  }

  // קופות
  funds(): Observable<Fund[]> {
    return this.http.get<Fund[]>('/funds');
  }

  createFund(input: FundInput): Observable<Fund> {
    return this.http.post<Fund>('/funds', input);
  }

  updateFund(id: number, input: Partial<FundInput>): Observable<Fund> {
    return this.http.put<Fund>(`/funds/${id}`, input);
  }

  deleteFund(id: number): Observable<void> {
    return this.http.delete<void>(`/funds/${id}`);
  }

  // התראות
  refreshAlerts(): void {
    this.http.get<AppAlert[]>('/alerts').subscribe({ next: (a) => this.alerts$.next(a), error: () => undefined });
  }

  dismissAlert(key: string): Observable<void> {
    return this.http.post<void>('/alerts/dismiss', { key }).pipe(tap(() => this.alerts$.next(this.alerts$.value.filter((a) => a.key !== key))));
  }

  // סעיף 46
  section46(year: number): Observable<Section46Summary> {
    return this.http.get<Section46Summary>('/tax/section46', { year: String(year) });
  }

  setSection46Payee(name: string, eligible: boolean): Observable<void> {
    return this.http.put<void>('/tax/section46/payee', { name, eligible });
  }

  // עוזר
  assistantEngines(): Observable<Record<AssistantEngine, boolean>> {
    return this.http.get<Record<AssistantEngine, boolean>>('/assistant/engines');
  }

  ask(question: string, engine: AssistantEngine, sessionId: string | null, history: AssistantTurn[]): Observable<AssistantAnswer> {
    return this.http.post<AssistantAnswer>('/assistant/ask', { question, engine, sessionId, history });
  }
}
