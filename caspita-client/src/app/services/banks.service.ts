import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HttpService } from './http.service';
import { BankConfig, SupportedCompany } from '../models/bank.model';

@Injectable({ providedIn: 'root' })
export class BanksService {
  constructor(private http: HttpService) {}

  getSupportedCompanies(): Observable<SupportedCompany[]> {
    return this.http.get<SupportedCompany[]>('/banks/supported');
  }

  getAll(): Observable<BankConfig[]> {
    return this.http.get<BankConfig[]>('/banks');
  }

  create(data: { companyId: string; displayName: string; credentials: Record<string, string> }): Observable<BankConfig> {
    return this.http.post<BankConfig>('/banks', data);
  }

  update(id: number, data: { displayName: string; credentials: Record<string, string>; isActive: boolean }): Observable<BankConfig> {
    return this.http.put<BankConfig>(`/banks/${id}`, data);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`/banks/${id}`);
  }
}
