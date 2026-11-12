import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ValidatorFn, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BankConfig, SupportedCompany } from '../../models/bank.model';

export interface BankFormDialogData {
  supportedCompanies: SupportedCompany[];
  bank?: BankConfig;
}

@Component({
  selector: 'app-bank-form-dialog',
  templateUrl: './bank-form-dialog.component.html',
  styleUrls: ['./bank-form-dialog.component.scss'],
  standalone: false,
})
export class BankFormDialogComponent implements OnInit {
  form!: FormGroup;
  credentialsForm!: FormGroup;
  selectedCompany: SupportedCompany | null = null;
  isEdit: boolean;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<BankFormDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: BankFormDialogData
  ) {
    this.isEdit = !!data.bank;
  }

  ngOnInit(): void {
    this.form = this.fb.group({
      companyId: [{ value: this.data.bank?.companyId || '', disabled: this.isEdit }, Validators.required],
      displayName: [this.data.bank?.displayName || '', Validators.required],
      isActive: [this.data.bank?.isActive ?? true],
    });

    this.credentialsForm = this.fb.group({});

    if (this.isEdit) {
      this.selectedCompany = this.data.supportedCompanies.find(c => c.id === this.data.bank!.companyId) || null;
      if (this.selectedCompany) this.buildCredentialsForm();
    }

    this.form.get('companyId')!.valueChanges.subscribe((id: string) => {
      this.selectedCompany = this.data.supportedCompanies.find(c => c.id === id) || null;
      if (this.selectedCompany) {
        this.form.patchValue({ displayName: this.selectedCompany.displayName });
        this.buildCredentialsForm();
      }
    });
  }

  buildCredentialsForm(): void {
    if (!this.selectedCompany) return;
    const controls: Record<string, [string, ValidatorFn[]]> = {};
    for (const field of this.selectedCompany.fields) {
      // בעריכה — ללא חובה, ריק = לא לשנות. טוקן OTP של וואן זירו תמיד רשות
      const optional = this.isEdit || field.key === 'otpLongTermToken';
      controls[field.key] = ['', optional ? [] : [Validators.required]];
    }
    this.credentialsForm = this.fb.group(controls);
  }

  credentialsChanged(): boolean {
    return Object.values(this.credentialsForm.value).some((v) => String(v).trim() !== '');
  }

  submit(): void {
    if (this.form.invalid) return;
    if (!this.isEdit && this.credentialsForm.invalid) return;

    const companyId = this.isEdit ? this.data.bank!.companyId : this.form.value.companyId;

    // בעריכה: שלח credentials רק אם מילאו לפחות שדה אחד
    const credentials = this.isEdit && !this.credentialsChanged()
      ? null
      : this.credentialsForm.value;

    this.dialogRef.close({
      companyId,
      displayName: this.form.value.displayName,
      credentials,
      isActive: this.form.value.isActive,
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
