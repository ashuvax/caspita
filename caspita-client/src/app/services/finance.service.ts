import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HttpService } from './http.service';
import { Account, MaaserOverride } from '../models/bank.model';
import { Category, MerchantSummary, ForecastResult, MaaserRule, MaaserRuleKind, MaaserSettings, MaaserSummary, RecurringInput, RecurringItem, RecurringStatus, DashboardResult } from '../models/finance.model';

@Injectable({ providedIn: 'root' })
export class FinanceService {
  constructor(private http: HttpService) {}

  // חשבונות
  getAccounts(): Observable<Account[]> {
    return this.http.get<Account[]>('/accounts');
  }

  updateAccount(id: number, data: { label?: string | null; paysFromAccountId?: number | null; chargeDay?: number | null; isHidden?: boolean }): Observable<void> {
    return this.http.put<void>(`/accounts/${id}`, data);
  }

  // מעשרות
  setMaaserOverride(transactionId: number, override: MaaserOverride | null): Observable<void> {
    return this.http.put<void>(`/transactions/${transactionId}/maaser`, { override });
  }

  getMaaserSummary(): Observable<MaaserSummary> {
    return this.http.get<MaaserSummary>('/maaser/summary');
  }

  updateMaaserSettings(settings: Partial<MaaserSettings>): Observable<MaaserSettings> {
    return this.http.put<MaaserSettings>('/maaser/settings', settings);
  }

  getMaaserRules(): Observable<MaaserRule[]> {
    return this.http.get<MaaserRule[]>('/maaser/rules');
  }

  addMaaserRule(kind: MaaserRuleKind, pattern: string): Observable<MaaserRule> {
    return this.http.post<MaaserRule>('/maaser/rules', { kind, pattern });
  }

  deleteMaaserRule(id: number): Observable<void> {
    return this.http.delete<void>(`/maaser/rules/${id}`);
  }

  // הוראות קבע
  getRecurring(): Observable<RecurringItem[]> {
    return this.http.get<RecurringItem[]>('/recurring');
  }

  detectRecurring(): Observable<RecurringItem[]> {
    return this.http.post<RecurringItem[]>('/recurring/detect', {});
  }

  createRecurring(input: RecurringInput): Observable<RecurringItem[]> {
    return this.http.post<RecurringItem[]>('/recurring', input);
  }

  updateRecurring(id: number, data: { status?: RecurringStatus; userAmount?: number | null; dayOfMonth?: number }): Observable<void> {
    return this.http.put<void>(`/recurring/${id}`, data);
  }

  deleteRecurring(id: number): Observable<void> {
    return this.http.delete<void>(`/recurring/${id}`);
  }

  // קטגוריות
  getCategories(): Observable<Category[]> {
    return this.http.get<Category[]>('/categories');
  }

  createCategory(name: string, icon: string): Observable<Category[]> {
    return this.http.post<Category[]>('/categories', { name, icon });
  }

  updateCategory(id: number, data: { name?: string; icon?: string }): Observable<Category[]> {
    return this.http.put<Category[]>(`/categories/${id}`, data);
  }

  deleteCategory(id: number): Observable<void> {
    return this.http.delete<void>(`/categories/${id}`);
  }

  autoAssignCategories(): Observable<{ assigned: number; byCategory: { name: string; count: number }[] }> {
    return this.http.post<{ assigned: number; byCategory: { name: string; count: number }[] }>('/categories/auto', {});
  }

  getCategoryMerchants(): Observable<MerchantSummary[]> {
    return this.http.get<MerchantSummary[]>('/categories/merchants');
  }

  setMerchantCategory(merchant: string, categoryId: number | null): Observable<void> {
    return this.http.put<void>('/categories/merchant', { merchant, categoryId });
  }

  setTransactionCategory(transactionId: number, categoryId: number | null): Observable<void> {
    return this.http.put<void>(`/transactions/${transactionId}/category`, { categoryId });
  }

  // מזומן
  addCash(data: { date: string; amount: number; description: string; categoryId: number | null; note: string | null }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>('/cash', data);
  }

  deleteCash(id: number): Observable<void> {
    return this.http.delete<void>(`/cash/${id}`);
  }

  // לאורך זמן
  getDashboard(months: number): Observable<DashboardResult> {
    return this.http.get<DashboardResult>('/dashboard', { months: String(months) });
  }

  // תחזית
  getForecast(until?: string): Observable<ForecastResult> {
    return this.http.get<ForecastResult>('/forecast', until ? { until } : undefined);
  }
}
