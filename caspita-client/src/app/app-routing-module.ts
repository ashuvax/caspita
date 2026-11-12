import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  { path: '', redirectTo: 'overview', pathMatch: 'full' },
  {
    path: 'overview',
    loadChildren: () => import('./overview/overview.module').then((m) => m.OverviewModule),
  },
  {
    path: 'transactions',
    loadChildren: () => import('./transactions/transactions.module').then((m) => m.TransactionsModule),
  },
  {
    path: 'dashboard',
    loadChildren: () => import('./dashboard/dashboard.module').then((m) => m.DashboardModule),
  },
  {
    path: 'investments',
    loadChildren: () => import('./investments/investments.module').then((m) => m.InvestmentsModule),
  },
  {
    path: 'savings',
    loadChildren: () => import('./savings/savings.module').then((m) => m.SavingsModule),
  },
  {
    path: 'loans',
    loadChildren: () => import('./loans/loans.module').then((m) => m.LoansModule),
  },
  {
    path: 'forecast',
    loadChildren: () => import('./forecast/forecast.module').then((m) => m.ForecastModule),
  },
  {
    path: 'maaser',
    loadChildren: () => import('./maaser/maaser.module').then((m) => m.MaaserModule),
  },
  {
    path: 'recurring',
    loadChildren: () => import('./recurring/recurring.module').then((m) => m.RecurringModule),
  },
  {
    path: 'categories',
    loadChildren: () => import('./categories/categories.module').then((m) => m.CategoriesModule),
  },
  {
    path: 'banks',
    loadChildren: () => import('./banks/banks.module').then((m) => m.BanksModule),
  },
  { path: '**', redirectTo: 'overview' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
