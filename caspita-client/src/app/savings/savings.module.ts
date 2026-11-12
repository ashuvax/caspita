import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { SavingsComponent } from './savings.component';
import { SavingsDialogComponent } from './savings-dialog/savings-dialog.component';

const routes: Routes = [{ path: '', component: SavingsComponent }];

@NgModule({
  declarations: [SavingsComponent, SavingsDialogComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class SavingsModule {}
