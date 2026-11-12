import { Pipe, PipeTransform } from '@angular/core';
import { monthLabel } from '../models/finance.model';

/** 'YYYY-MM' → 'נובמבר 2026' */
@Pipe({ name: 'monthLabel', standalone: false })
export class MonthLabelPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ? monthLabel(value) : '';
  }
}
