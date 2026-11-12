import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { YearComponent } from './year.component';

const routes: Routes = [{ path: '', component: YearComponent }];

@NgModule({
  declarations: [YearComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class YearModule {}
