import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { LoansComponent } from './loans.component';
import { LoanDialogComponent } from './loan-dialog/loan-dialog.component';

const routes: Routes = [
  { path: 'given', component: LoansComponent, data: { direction: 'given' } },
  { path: 'taken', component: LoansComponent, data: { direction: 'taken' } },
  { path: '', redirectTo: 'given', pathMatch: 'full' },
];

@NgModule({
  declarations: [LoansComponent, LoanDialogComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class LoansModule {}
