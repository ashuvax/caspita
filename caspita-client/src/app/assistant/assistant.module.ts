import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { AssistantComponent } from './assistant.component';

const routes: Routes = [{ path: '', component: AssistantComponent }];

@NgModule({
  declarations: [AssistantComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class AssistantModule {}
