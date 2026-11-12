import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { ForecastComponent } from './forecast.component';
import { BalanceChartComponent } from './balance-chart/balance-chart.component';

const routes: Routes = [{ path: '', component: ForecastComponent }];

@NgModule({
  declarations: [ForecastComponent, BalanceChartComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class ForecastModule {}
