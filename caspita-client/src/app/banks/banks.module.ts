import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { BanksComponent } from './banks.component';
import { BankFormDialogComponent } from './bank-form-dialog/bank-form-dialog.component';

const routes: Routes = [{ path: '', component: BanksComponent }];

@NgModule({
  declarations: [BanksComponent, BankFormDialogComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class BanksModule {}
