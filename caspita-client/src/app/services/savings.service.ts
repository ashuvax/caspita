import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HttpService } from './http.service';
import { Savings, SavingsCandidate, SavingsInput } from '../models/savings.model';

@Injectable({ providedIn: 'root' })
export class SavingsService {
  constructor(private http: HttpService) {}

  list(): Observable<Savings[]> {
    return this.http.get<Savings[]>('/savings');
  }

  create(input: SavingsInput): Observable<Savings> {
    return this.http.post<Savings>('/savings', input);
  }

  update(id: number, input: SavingsInput): Observable<Savings> {
    return this.http.put<Savings>(`/savings/${id}`, input);
  }

  remove(id: number): Observable<void> {
    return this.http.delete<void>(`/savings/${id}`);
  }

  candidates(id: number): Observable<SavingsCandidate[]> {
    return this.http.get<SavingsCandidate[]>(`/savings/${id}/candidates`);
  }

  link(id: number, transactionId: number): Observable<void> {
    return this.http.post<void>(`/savings/${id}/link`, { transactionId });
  }

  unlink(transactionId: number): Observable<void> {
    return this.http.delete<void>(`/savings/link/${transactionId}`);
  }

  addEntry(id: number, entry: { date: string; amount: number; note: string | null }): Observable<void> {
    return this.http.post<void>(`/savings/${id}/entries`, entry);
  }

  removeEntry(entryId: number): Observable<void> {
    return this.http.delete<void>(`/savings/entries/${entryId}`);
  }
}
