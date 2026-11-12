import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { DashboardComponent } from './dashboard.component';
import { MonthChartComponent } from './month-chart/month-chart.component';

const routes: Routes = [{ path: '', component: DashboardComponent }];

@NgModule({
  declarations: [DashboardComponent, MonthChartComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class DashboardModule {}
