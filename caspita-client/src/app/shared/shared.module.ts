import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MaterialModule } from './material.module';
import { ListRowComponent } from './components/list-row/list-row.component';
import { OtpDialogComponent } from './components/otp-dialog/otp-dialog.component';
import { MonthLabelPipe } from './month-label.pipe';

@NgModule({
  declarations: [ListRowComponent, OtpDialogComponent, MonthLabelPipe],
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterModule, MaterialModule],
  exports: [CommonModule, ReactiveFormsModule, FormsModule, RouterModule, MaterialModule, ListRowComponent, OtpDialogComponent, MonthLabelPipe],
})
export class SharedModule {}
