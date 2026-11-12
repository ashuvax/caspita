import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { TagsComponent } from './tags.component';

const routes: Routes = [{ path: '', component: TagsComponent }];

@NgModule({
  declarations: [TagsComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class TagsModule {}
