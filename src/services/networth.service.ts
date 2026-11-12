import { Account } from '../models/account.model';
import { investmentsService } from './investments.service';
import { loansService } from './loans.service';
import { savingsService } from './savings.service';
import { round2 } from '../utils/text';

export interface NetWorth {
  bank: number;
  savings: number;
  /** כמה אפשר למשוך מהחסכונות בפועל (אחרי ניכויים) */
  savingsWithdrawable: number;
  investments: number;
  /** הלוואות שנתתי — כסף שאמור לחזור */
  owedToMe: number;
  /** הלוואות שלקחתי — כולל משכנתא */
  debts: number;
  assets: number;
  net: number;
}

/** שווי נקי: מה שיש (בנק, חסכונות, השקעות, הלוואות שיחזרו) פחות מה שחייבים */
async function get(): Promise<NetWorth> {
  const [banks, savings, investments, given, taken] = await Promise.all([
    Account.findAll({ where: { kind: 'bank', isHidden: false } }),
    savingsService.list(),
    investmentsService.totalIls(),
    loansService.list('given'),
    loansService.list('taken'),
  ]);
  const bank = banks.reduce((s, a) => s + (a.balance ?? 0), 0);
  const sv = savings.reduce((s, x) => s + x.value, 0);
  const svw = savings.reduce((s, x) => s + x.withdrawable, 0);
  const owed = given.reduce((s, l) => s + l.remaining, 0);
  const debts = taken.reduce((s, l) => s + l.remaining, 0);
  const assets = bank + sv + investments + owed;
  return {
    bank: round2(bank),
    savings: round2(sv),
    savingsWithdrawable: round2(svw),
    investments: round2(investments),
    owedToMe: round2(owed),
    debts: round2(debts),
    assets: round2(assets),
    net: round2(assets - debts),
  };
}

export const networthService = { get };
