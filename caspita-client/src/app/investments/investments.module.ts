import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { SharedModule } from '../shared/shared.module';
import { InvestmentsComponent } from './investments.component';
import { HoldingDialogComponent } from './holding-dialog/holding-dialog.component';

const routes: Routes = [{ path: '', component: InvestmentsComponent }];

@NgModule({
  declarations: [InvestmentsComponent, HoldingDialogComponent],
  imports: [SharedModule, MatAutocompleteModule, RouterModule.forChild(routes)],
})
export class InvestmentsModule {}
