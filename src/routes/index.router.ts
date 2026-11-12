import express, { Router } from 'express';
import { getSupportedCompanies, getAllBanks, createBank, updateBank, deleteBank } from '../controllers/banks.controller';
import * as finance from '../controllers/finance.controller';
import * as features from '../controllers/features.controller';

export const router = Router();

router.get('/banks/supported', getSupportedCompanies);
router.get('/banks', getAllBanks);
router.post('/banks', createBank);
router.put('/banks/:id', updateBank);
router.delete('/banks/:id', deleteBank);

router.get('/accounts', finance.getAccounts);
router.put('/accounts/:id', finance.updateAccount);

router.get('/transactions/grouped', finance.getGrouped);
router.put('/transactions/:id/maaser', finance.setMaaserOverride);
router.put('/transactions/:id/splits', features.setSplits);

router.get('/installments', features.getInstallments);
router.post('/installments/loan', features.markInstallmentLoan);

router.get('/funds', features.getFunds);
router.post('/funds', features.createFund);
router.put('/funds/:id', features.updateFund);
router.delete('/funds/:id', features.deleteFund);

router.get('/alerts', features.getAlerts);
router.post('/alerts/dismiss', features.dismissAlert);

router.get('/tax/section46', features.getSection46);
router.put('/tax/section46/payee', features.setSection46Payee);
router.put('/tax/section46/transactions', features.setSection46Transactions);
router.post('/tax/donations/preview', express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '15mb' }), features.previewDonationReport);
router.post('/tax/donations/apply', features.applyDonationReport);

router.get('/wallet', features.getWallet);

router.get('/tags', features.getTags);
router.post('/tags', features.createTag);
router.get('/tags/:id', features.getTag);
router.put('/tags/:id', features.updateTag);
router.delete('/tags/:id', features.deleteTag);
router.post('/tags/:id/transactions', features.addTagToTransactions);
router.put('/transactions/:id/tags', features.setTransactionTags);

router.get('/categories/rules', features.getRules);
router.post('/categories/rules', features.createRule);
router.post('/categories/rules/preview', features.previewRule);
router.put('/categories/rules/:id', features.updateRule);
router.delete('/categories/rules/:id', features.deleteRule);

router.get('/year', features.getYearSummary);

router.get('/assistant/dataset', features.getAssistantDataset);
router.get('/assistant/engines', features.getAssistantEngines);
router.post('/assistant/ask', features.askAssistant);
router.post('/sync', finance.startSync);
router.get('/sync/status', finance.getSyncStatus);

router.get('/otp/status', finance.getOtpStatus);
router.post('/otp/submit', finance.submitOtp);
router.post('/otp/cancel', finance.cancelOtp);

router.get('/maaser/summary', finance.getMaaserSummary);
router.put('/maaser/settings', finance.updateMaaserSettings);
router.get('/maaser/rules', finance.getMaaserRules);
router.post('/maaser/rules', finance.addMaaserRule);
router.delete('/maaser/rules/:id', finance.deleteMaaserRule);

router.get('/recurring', finance.getRecurring);
router.post('/recurring', finance.createRecurring);
router.post('/recurring/detect', finance.detectRecurring);
router.put('/recurring/:id', finance.updateRecurring);
router.delete('/recurring/:id', finance.deleteRecurring);

router.get('/categories', finance.getCategories);
router.post('/categories', finance.createCategory);
router.get('/categories/merchants', finance.getCategoryMerchants);
router.post('/categories/auto', finance.autoAssignCategories);
router.put('/categories/merchant', finance.setMerchantCategory);
router.put('/categories/:id', finance.updateCategory);
router.delete('/categories/:id', finance.deleteCategory);
router.put('/transactions/:id/category', finance.setTransactionCategory);

router.post('/cash', finance.addCash);
router.delete('/cash/:id', finance.deleteCash);

router.get('/forecast', finance.getForecast);
router.get('/dashboard', finance.getDashboard);

router.get('/loans', finance.getLoans);
router.get('/loans/suggestions', finance.getLoanSuggestions);
router.post('/loans', finance.createLoan);
router.put('/loans/:id', finance.updateLoan);
router.delete('/loans/:id', finance.deleteLoan);
router.get('/loans/:id/candidates', finance.getLoanCandidates);
router.post('/loans/:id/link', finance.linkLoanTransaction);
router.delete('/loans/link/:transactionId', finance.unlinkLoanTransaction);
router.post('/loans/:id/payments', finance.addLoanPayment);
router.delete('/loans/payments/:paymentId', finance.deleteLoanPayment);

router.get('/investments', finance.getInvestments);
router.post('/investments', finance.createHolding);
router.put('/investments/:id', finance.updateHolding);
router.delete('/investments/:id', finance.deleteHolding);
router.get('/networth', finance.getNetWorth);

router.get('/savings', finance.getSavings);
router.post('/savings', finance.createSavings);
router.put('/savings/:id', finance.updateSavings);
router.delete('/savings/:id', finance.deleteSavings);
router.get('/savings/:id/candidates', finance.getSavingsCandidates);
router.post('/savings/:id/link', finance.linkSavingsTransaction);
router.delete('/savings/link/:transactionId', finance.unlinkSavingsTransaction);
router.post('/savings/:id/entries', finance.addSavingsEntry);
router.delete('/savings/entries/:entryId', finance.deleteSavingsEntry);
