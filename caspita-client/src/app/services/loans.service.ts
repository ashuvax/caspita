import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HttpService } from './http.service';
import { Loan, LoanCandidate, LoanDirection, LoanInput, LoanSuggestion } from '../models/loan.model';

@Injectable({ providedIn: 'root' })
export class LoansService {
  constructor(private http: HttpService) {}

  list(direction: LoanDirection): Observable<Loan[]> {
    return this.http.get<Loan[]>('/loans', { direction });
  }

  suggestions(direction: LoanDirection): Observable<LoanSuggestion[]> {
    return this.http.get<LoanSuggestion[]>('/loans/suggestions', { direction });
  }

  create(input: LoanInput): Observable<Loan> {
    return this.http.post<Loan>('/loans', input);
  }

  update(id: number, input: LoanInput): Observable<Loan> {
    return this.http.put<Loan>(`/loans/${id}`, input);
  }

  remove(id: number): Observable<void> {
    return this.http.delete<void>(`/loans/${id}`);
  }

  candidates(id: number): Observable<LoanCandidate[]> {
    return this.http.get<LoanCandidate[]>(`/loans/${id}/candidates`);
  }

  link(id: number, transactionId: number): Observable<void> {
    return this.http.post<void>(`/loans/${id}/link`, { transactionId });
  }

  unlink(transactionId: number): Observable<void> {
    return this.http.delete<void>(`/loans/link/${transactionId}`);
  }

  addPayment(id: number, payment: { date: string; amount: number; note: string | null }): Observable<void> {
    return this.http.post<void>(`/loans/${id}/payments`, payment);
  }

  removePayment(paymentId: number): Observable<void> {
    return this.http.delete<void>(`/loans/payments/${paymentId}`);
  }
}
