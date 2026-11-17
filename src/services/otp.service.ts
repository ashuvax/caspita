/** לאן הבנק שולח את הקוד: הודעת SMS או שיחה קולית */
export type OtpChannel = 'sms' | 'voice';

export interface OtpOptions {
  attempt?: number;
  /** ערוצים שהמשתמש יכול לבחור מהם (רק אם הבנק מציע בחירה) */
  channels?: OtpChannel[];
  /** הקוד עוד לא נשלח — קודם צריך לבחור ערוץ */
  needsChannel?: boolean;
  /** שולח (או שולח שוב) את הקוד בערוץ שנבחר. מחזיר false אם לא נמצא כפתור מתאים */
  sendVia?: (channel: OtpChannel) => Promise<boolean>;
}

interface PendingOtp {
  id: number;
  bankName: string;
  attempt: number;
  channels: OtpChannel[];
  needsChannel: boolean;
  sentVia?: OtpChannel;
  sendVia?: (channel: OtpChannel) => Promise<boolean>;
  resolve: (code: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** תור בקשות לקוד אימות (SMS או שיחה) — כמה בנקים יכולים לבקש קוד במקביל, ה-UI מטפל בהם אחד-אחד */
const queue: PendingOtp[] = [];
let nextId = 1;

function waitForOtp(bankName: string, options: OtpOptions = {}, timeoutMs = 5 * 60 * 1000): Promise<string> {
  const { attempt = 1, channels = [], needsChannel = false, sendVia } = options;
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      remove(id);
      reject(new Error(`לא הוזן קוד אימות עבור ${bankName} בזמן`));
    }, timeoutMs);
    queue.push({ id, bankName, attempt, channels, needsChannel: needsChannel && !!sendVia, sendVia, resolve, reject, timer });
  });
}

function remove(id: number): PendingOtp | undefined {
  const idx = queue.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;
  const [item] = queue.splice(idx, 1);
  clearTimeout(item.timer);
  return item;
}

function submitOtp(code: string, id?: number): boolean {
  const target = id !== undefined ? queue.find((p) => p.id === id) : queue[0];
  if (!target) return false;
  remove(target.id);
  target.resolve(code);
  return true;
}

export interface OtpStatus {
  needed: boolean;
  id?: number;
  bankName?: string;
  attempt?: number;
  channels?: OtpChannel[];
  needsChannel?: boolean;
  sentVia?: OtpChannel;
}

function getStatus(): OtpStatus {
  const first = queue[0];
  if (!first) return { needed: false };
  return {
    needed: true,
    id: first.id,
    bankName: first.bankName,
    attempt: first.attempt,
    channels: first.sendVia ? first.channels : [],
    needsChannel: first.needsChannel,
    sentVia: first.sentVia,
  };
}

/** המשתמש בחר לאן לשלוח את הקוד — לוחצים על הכפתור המתאים באתר הבנק */
async function sendVia(channel: OtpChannel, id?: number): Promise<boolean> {
  const target = id !== undefined ? queue.find((p) => p.id === id) : queue[0];
  if (!target?.sendVia || !target.channels.includes(channel)) return false;
  const ok = await target.sendVia(channel);
  if (ok) {
    target.sentVia = channel;
    target.needsChannel = false;
  }
  return ok;
}

function cancel(id?: number): void {
  const target = id !== undefined ? queue.find((p) => p.id === id) : queue[0];
  if (!target) return;
  remove(target.id);
  target.reject(new Error(`הזנת קוד האימות עבור ${target.bankName} בוטלה`));
}

export const otpService = { waitForOtp, submitOtp, getStatus, cancel, sendVia };
