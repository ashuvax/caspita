import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'app-otp-dialog',
  templateUrl: './otp-dialog.component.html',
  styleUrls: ['./otp-dialog.component.scss'],
  standalone: false,
})
export class OtpDialogComponent {
  code = '';

  constructor(
    private dialogRef: MatDialogRef<OtpDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { bankName: string; attempt: number }
  ) {}

  submit(): void {
    if (this.code.trim()) {
      this.dialogRef.close(this.code.trim());
    }
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
