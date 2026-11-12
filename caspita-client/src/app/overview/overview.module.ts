import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { OverviewComponent } from './overview.component';

const routes: Routes = [{ path: '', component: OverviewComponent }];

@NgModule({
  declarations: [OverviewComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class OverviewModule {}
