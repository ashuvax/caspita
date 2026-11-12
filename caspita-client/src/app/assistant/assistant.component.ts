import { AfterViewChecked, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FeaturesService } from '../services/features.service';
import { AssistantEngine, AssistantTurn } from '../models/features.model';

interface ChatMessage extends AssistantTurn {
  engine?: AssistantEngine;
  seconds?: number;
  error?: boolean;
}

/** השיחה נשמרת כל עוד האפליקציה פתוחה (גם במעבר בין מסכים) */
const state: { messages: ChatMessage[]; sessionId: string | null; engine: AssistantEngine } = { messages: [], sessionId: null, engine: 'claude' };

const SUGGESTIONS = [
  'כמה הוצאתי על אוכל החודש לעומת החודש שעבר?',
  'מה שלוש ההוצאות שהכי גדלו השנה?',
  'כמה מעשרות נתתי השנה, ולמי הכי הרבה?',
  'מתי תיגמר המשכנתא בקצב הנוכחי?',
  'כמה אני מוציא בממוצע בחודש על דלק?',
  'אילו מנויים והוראות קבע אפשר לבדוק אם צריך?',
];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

@Component({
  selector: 'app-assistant',
  templateUrl: './assistant.component.html',
  styleUrls: ['./assistant.component.scss'],
  standalone: false,
})
export class AssistantComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('scroller') scroller?: ElementRef<HTMLElement>;

  question = '';
  asking = false;
  engines: Record<AssistantEngine, boolean> | null = null;
  readonly suggestions = SUGGESTIONS;
  private scrollPending = false;
  private destroy$ = new Subject<void>();

  constructor(private features: FeaturesService) {}

  get messages(): ChatMessage[] {
    return state.messages;
  }

  get engine(): AssistantEngine {
    return state.engine;
  }

  set engine(value: AssistantEngine) {
    if (value !== state.engine) state.sessionId = null;
    state.engine = value;
  }

  ngOnInit(): void {
    this.features
      .assistantEngines()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (e) => {
          this.engines = e;
          if (!e[state.engine] && (e.claude || e.codex)) state.engine = e.claude ? 'claude' : 'codex';
        },
        error: () => (this.engines = { claude: false, codex: false }),
      });
    this.scrollPending = true;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngAfterViewChecked(): void {
    if (this.scrollPending && this.scroller) {
      this.scroller.nativeElement.scrollTop = this.scroller.nativeElement.scrollHeight;
      this.scrollPending = false;
    }
  }

  noEngine(): boolean {
    return !!this.engines && !this.engines.claude && !this.engines.codex;
  }

  bothEngines(): boolean {
    return !!this.engines?.claude && !!this.engines?.codex;
  }

  ask(text: string = this.question): void {
    const q = text.trim();
    if (!q || this.asking) return;
    const history: AssistantTurn[] = state.messages.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    state.messages = [...state.messages, { role: 'user', text: q }];
    this.question = '';
    this.asking = true;
    this.scrollPending = true;
    this.features
      .ask(q, state.engine, state.sessionId, history)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (r) => {
          state.sessionId = r.sessionId;
          state.messages = [...state.messages, { role: 'assistant', text: r.answer, engine: r.engine, seconds: Math.round(r.durationMs / 1000) }];
          this.asking = false;
          this.scrollPending = true;
        },
        error: (err: HttpErrorResponse) => {
          const msg = (err.error as { error?: string } | null)?.error ?? 'לא הצלחתי לקבל תשובה';
          state.messages = [...state.messages, { role: 'assistant', text: msg, error: true }];
          this.asking = false;
          this.scrollPending = true;
        },
      });
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.ask();
    }
  }

  reset(): void {
    state.messages = [];
    state.sessionId = null;
  }

  engineName(e: AssistantEngine | undefined): string {
    return e === 'codex' ? 'Codex' : 'Claude';
  }

  /** עיצוב בסיסי: **מודגש**, שורות "- " כרשימה */
  render(text: string): string {
    return text
      .split('\n')
      .map((line) => {
        const html = escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        if (/^\s*[-•]\s+/.test(line)) return `<span class="li">${html.replace(/^\s*[-•]\s+/, '')}</span>`;
        return html ? `<span class="p">${html}</span>` : '<span class="gap"></span>';
      })
      .join('');
  }
}
