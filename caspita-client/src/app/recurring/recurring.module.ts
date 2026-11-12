import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { RecurringComponent } from './recurring.component';

const routes: Routes = [{ path: '', component: RecurringComponent }];

@NgModule({
  declarations: [RecurringComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class RecurringModule {}
