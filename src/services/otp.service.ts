interface PendingOtp {
  id: number;
  bankName: string;
  attempt: number;
  resolve: (code: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** תור בקשות לקוד SMS — כמה בנקים יכולים לבקש קוד במקביל, ה-UI מטפל בהם אחד-אחד */
const queue: PendingOtp[] = [];
let nextId = 1;

function waitForOtp(bankName: string, attempt = 1, timeoutMs = 5 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      remove(id);
      reject(new Error(`לא הוזן קוד SMS עבור ${bankName} בזמן`));
    }, timeoutMs);
    queue.push({ id, bankName, attempt, resolve, reject, timer });
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

function getStatus(): { needed: boolean; id?: number; bankName?: string; attempt?: number } {
  const first = queue[0];
  if (!first) return { needed: false };
  return { needed: true, id: first.id, bankName: first.bankName, attempt: first.attempt };
}

function cancel(id?: number): void {
  const target = id !== undefined ? queue.find((p) => p.id === id) : queue[0];
  if (!target) return;
  remove(target.id);
  target.reject(new Error(`הזנת קוד ה-SMS עבור ${target.bankName} בוטלה`));
}

export const otpService = { waitForOtp, submitOtp, getStatus, cancel };
