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
  SplitPartInput,
  WalletSummary,
  Tag,
  TagDetail,
  CategoryRule,
  CategoryRuleInput,
  RulePreview,
  YearSummary,
  DonationPreview,
  DonationApplyResult,
  DonationPreviewEntry,
} from '../models/features.model';

@Injectable({ providedIn: 'root' })
export class FeaturesService {
  /** ההתראות הפתוחות — משותף לפעמון ולמסך הבית */
  readonly alerts$ = new BehaviorSubject<AppAlert[]>([]);

  constructor(private http: HttpService) {}

  // פיצול עסקה
  setSplits(transactionId: number, parts: SplitPartInput[]): Observable<void> {
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

  setSection46Payee(name: string, eligible: boolean, year: number): Observable<void> {
    return this.http.put<void>('/tax/section46/payee', { name, eligible, year });
  }

  // ארנק מזומן
  wallet(): Observable<WalletSummary> {
    return this.http.get<WalletSummary>('/wallet');
  }

  // תגיות
  tags(): Observable<Tag[]> {
    return this.http.get<Tag[]>('/tags');
  }

  tag(id: number): Observable<TagDetail> {
    return this.http.get<TagDetail>(`/tags/${id}`);
  }

  createTag(name: string, color: string): Observable<Tag> {
    return this.http.post<Tag>('/tags', { name, color });
  }

  updateTag(id: number, data: { name?: string; color?: string }): Observable<void> {
    return this.http.put<void>(`/tags/${id}`, data);
  }

  deleteTag(id: number): Observable<void> {
    return this.http.delete<void>(`/tags/${id}`);
  }

  setTransactionTags(transactionId: number, tagIds: number[]): Observable<void> {
    return this.http.put<void>(`/transactions/${transactionId}/tags`, { tagIds });
  }

  addTagToTransactions(tagId: number, transactionIds: number[]): Observable<{ added: number }> {
    return this.http.post<{ added: number }>(`/tags/${tagId}/transactions`, { transactionIds });
  }

  // כללי סיווג
  rules(): Observable<CategoryRule[]> {
    return this.http.get<CategoryRule[]>('/categories/rules');
  }

  createRule(input: CategoryRuleInput): Observable<CategoryRule> {
    return this.http.post<CategoryRule>('/categories/rules', input);
  }

  updateRule(id: number, input: CategoryRuleInput): Observable<CategoryRule> {
    return this.http.put<CategoryRule>(`/categories/rules/${id}`, input);
  }

  deleteRule(id: number): Observable<void> {
    return this.http.delete<void>(`/categories/rules/${id}`);
  }

  previewRule(input: Omit<CategoryRuleInput, 'categoryId'>): Observable<RulePreview> {
    return this.http.post<RulePreview>('/categories/rules/preview', input);
  }

  // ייבוא דוח תרומות (PDF מרשות המסים)
  previewDonations(file: File): Observable<DonationPreview> {
    return this.http.post<DonationPreview>('/tax/donations/preview', new Blob([file], { type: 'application/pdf' }));
  }

  applyDonations(entries: DonationPreviewEntry[], markPayees: boolean): Observable<DonationApplyResult> {
    const body = entries.map((e) => ({
      date: e.date,
      org: e.org,
      amount: e.amount,
      receipt: e.receipt,
      transactionId: e.transaction?.id ?? null,
      createCash: e.status === 'cash_new',
    }));
    return this.http.post<DonationApplyResult>('/tax/donations/apply', { entries: body, markPayees });
  }

  // סיכום שנה
  year(year: number): Observable<YearSummary> {
    return this.http.get<YearSummary>('/year', { year: String(year) });
  }

  // עוזר
  assistantEngines(): Observable<Record<AssistantEngine, boolean>> {
    return this.http.get<Record<AssistantEngine, boolean>>('/assistant/engines');
  }

  ask(question: string, engine: AssistantEngine, sessionId: string | null, history: AssistantTurn[]): Observable<AssistantAnswer> {
    return this.http.post<AssistantAnswer>('/assistant/ask', { question, engine, sessionId, history });
  }
}
