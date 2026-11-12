import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HttpService } from './http.service';
import { TransactionsResult } from '../models/bank.model';

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  constructor(private http: HttpService) {}

  getGrouped(month: string): Observable<TransactionsResult> {
    return this.http.get<TransactionsResult>('/transactions/grouped', { month });
  }
}
