import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { FundsComponent } from './funds.component';
import { FundDialogComponent } from './fund-dialog/fund-dialog.component';

const routes: Routes = [{ path: '', component: FundsComponent }];

@NgModule({
  declarations: [FundsComponent, FundDialogComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class FundsModule {}
