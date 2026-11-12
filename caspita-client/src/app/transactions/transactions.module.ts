import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { TransactionsComponent } from './transactions.component';
import { TransactionDetailDialogComponent } from './transaction-detail-dialog/transaction-detail-dialog.component';
import { CashDialogComponent } from './cash-dialog/cash-dialog.component';

const routes: Routes = [{ path: '', component: TransactionsComponent }];

@NgModule({
  declarations: [TransactionsComponent, TransactionDetailDialogComponent, CashDialogComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class TransactionsModule {}
