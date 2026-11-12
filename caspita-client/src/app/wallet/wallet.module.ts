import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { WalletComponent } from './wallet.component';

const routes: Routes = [{ path: '', component: WalletComponent }];

@NgModule({
  declarations: [WalletComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class WalletModule {}
