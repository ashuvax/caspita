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
    path: 'assistant',
    loadChildren: () => import('./assistant/assistant.module').then((m) => m.AssistantModule),
  },
  {
    path: 'installments',
    loadChildren: () => import('./installments/installments.module').then((m) => m.InstallmentsModule),
  },
  {
    path: 'wallet',
    loadChildren: () => import('./wallet/wallet.module').then((m) => m.WalletModule),
  },
  {
    path: 'tags',
    loadChildren: () => import('./tags/tags.module').then((m) => m.TagsModule),
  },
  {
    path: 'year',
    loadChildren: () => import('./year/year.module').then((m) => m.YearModule),
  },
  {
    path: 'funds',
    loadChildren: () => import('./funds/funds.module').then((m) => m.FundsModule),
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
