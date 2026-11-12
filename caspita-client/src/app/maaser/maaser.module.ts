import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { MaaserComponent } from './maaser.component';

const routes: Routes = [{ path: '', component: MaaserComponent }];

@NgModule({
  declarations: [MaaserComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class MaaserModule {}
