import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-list-row',
  templateUrl: './list-row.component.html',
  styleUrls: ['./list-row.component.scss'],
  standalone: false,
})
export class ListRowComponent {
  @Input() icon = '';
  @Input() iconGradient = 'primary';
  @Input() title = '';
  @Input() subtitle = '';
  @Input() value = '';
  @Input() valueColor: 'expense' | 'income' | 'neutral' = 'neutral';
  @Input() badge = '';
  @Input() badgeColor: 'active' | 'inactive' | 'warning' = 'active';
  @Input() clickable = true;
  @Output() rowClick = new EventEmitter<void>();

  onClick(): void {
    if (this.clickable) this.rowClick.emit();
  }
}
