import { Component, OnInit, OnDestroy } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BanksService } from '../services/banks.service';
import { Account, BankConfig, SupportedCompany } from '../models/bank.model';
import { FinanceService } from '../services/finance.service';
import { SyncService } from '../services/sync.service';
import { BankFormDialogComponent } from './bank-form-dialog/bank-form-dialog.component';

@Component({
  selector: 'app-banks',
  templateUrl: './banks.component.html',
  styleUrls: ['./banks.component.scss'],
  standalone: false,
})
export class BanksComponent implements OnInit, OnDestroy {
  banks: BankConfig[] = [];
  supportedCompanies: SupportedCompany[] = [];
  accounts: Account[] = [];
  readonly days = Array.from({ length: 31 }, (_, i) => i + 1);
  loading = true;

  private destroy$ = new Subject<void>();

  constructor(
    private banksService: BanksService,
    private finance: FinanceService,
    private sync: SyncService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.load();
    this.sync.synced$.pipe(takeUntil(this.destroy$)).subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.loading = true;
    forkJoin({
      banks: this.banksService.getAll(),
      companies: this.banksService.getSupportedCompanies(),
      accounts: this.finance.getAccounts(),
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ banks, companies, accounts }) => {
        this.banks = banks;
        this.supportedCompanies = companies;
        this.accounts = accounts;
        this.loading = false;
      },
      error: () => {
        this.snackBar.open('שגיאה בטעינת הבנקים', 'סגור', { duration: 4000 });
        this.loading = false;
      },
    });
  }

  openAddDialog(): void {
    const ref = this.dialog.open(BankFormDialogComponent, {
      data: { supportedCompanies: this.supportedCompanies },
      width: '480px',
    });

    ref.afterClosed().pipe(takeUntil(this.destroy$)).subscribe((result) => {
      if (!result) return;
      this.banksService.create(result).pipe(takeUntil(this.destroy$)).subscribe({
        next: (bank) => {
          this.banks = [...this.banks, bank];
          this.snackBar.open(`${bank.displayName} נוסף בהצלחה`, 'סגור', { duration: 3000 });
        },
        error: () => this.snackBar.open('שגיאה בהוספת הבנק', 'סגור', { duration: 4000 }),
      });
    });
  }

  openEditDialog(bank: BankConfig): void {
    const ref = this.dialog.open(BankFormDialogComponent, {
      data: { supportedCompanies: this.supportedCompanies, bank },
      width: '480px',
    });

    ref.afterClosed().pipe(takeUntil(this.destroy$)).subscribe((result) => {
      if (!result) return;
      this.banksService.update(bank.id, result).pipe(takeUntil(this.destroy$)).subscribe({
        next: (updated) => {
          this.banks = this.banks.map((b) => (b.id === bank.id ? updated : b));
          this.snackBar.open('הבנק עודכן בהצלחה', 'סגור', { duration: 3000 });
        },
        error: () => this.snackBar.open('שגיאה בעדכון הבנק', 'סגור', { duration: 4000 }),
      });
    });
  }

  deleteBank(bank: BankConfig): void {
    if (!confirm(`למחוק את "${bank.displayName}"?`)) return;
    this.banksService.delete(bank.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.banks = this.banks.filter((b) => b.id !== bank.id);
        this.snackBar.open('הבנק נמחק בהצלחה', 'סגור', { duration: 3000 });
      },
      error: () => this.snackBar.open('שגיאה במחיקת הבנק', 'סגור', { duration: 4000 }),
    });
  }

  bankSubtitle(bank: BankConfig): string {
    const parts = [this.companyName(bank.companyId)];
    if (bank.lastSyncAt) parts.push(`סונכרן ${new Date(bank.lastSyncAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`);
    else parts.push('טרם סונכרן');
    if (bank.lastSyncError) parts.push(`שגיאה: ${bank.lastSyncError}`);
    return parts.join(' · ');
  }

  bankAccounts(): Account[] {
    return this.accounts.filter((a) => a.kind === 'bank');
  }

  cardAccounts(): Account[] {
    return this.accounts.filter((a) => a.kind === 'card');
  }

  updateAccount(account: Account, changes: { label?: string | null; paysFromAccountId?: number | null; chargeDay?: number | null; isHidden?: boolean }): void {
    this.finance.updateAccount(account.id, changes).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.snackBar.open('נשמר', 'סגור', { duration: 2000 });
        this.finance.getAccounts().pipe(takeUntil(this.destroy$)).subscribe((accounts) => (this.accounts = accounts));
      },
      error: () => this.snackBar.open('שגיאה בשמירה', 'סגור', { duration: 4000 }),
    });
  }

  renameAccount(account: Account, value: string): void {
    const label = value.trim() || null;
    if (label === account.label) return;
    this.updateAccount(account, { label });
  }

  companyName(companyId: string): string {
    return this.supportedCompanies.find((c) => c.id === companyId)?.displayName || companyId;
  }
}
