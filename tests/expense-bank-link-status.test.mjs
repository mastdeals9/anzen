import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/components/finance/ExpenseManager.tsx', import.meta.url),
  'utf8',
);

test('Expense row status accurately distinguishes linked, partial, unlinked, and unknown bank-link states', () => {
  assert.match(source, /if \(postingState === 'AMBIGUOUS'\) return 'unknown';/);
  assert.match(source, /if \(isCancelledPosting \|\| expense\.payment_method === 'cash'\) return 'unlinked';/);
  assert.match(source, /if \(isReconciled && \(recon\.reconciledAmount > 0\.01 \|\| recon\.grossCashPayable <= 0\.01\)\) return 'linked';/);
  assert.match(source, /if \(isPartiallyReconciled \|\| recon\.reconciledAmount > 0\.01\) return 'partial';/);
  assert.match(source, /expenseLinkStatus === 'linked'[\s\S]{0,100}'text-green-700 hover:bg-green-50'/);
  assert.match(source, /expenseLinkStatus === 'partial'[\s\S]{0,100}'text-amber-700 hover:bg-amber-50'/);
  assert.match(source, /expenseLinkStatus === 'unlinked'[\s\S]{0,100}'text-red-600 hover:bg-red-50'/);
  assert.match(source, /'text-gray-400 hover:bg-gray-100'/);
});

test('Expense bank-link status icon is placed immediately before View action button', () => {
  const indicator = source.indexOf('aria-label={`Bank reconciliation status for ${expense.voucher_number || \'expense\'}: ${expenseLinkStatus}`');
  const view = source.indexOf('<FinanceActionButton\n                            action="view"', indicator);
  assert.ok(indicator >= 0, 'Expense row must show a bank-link status icon');
  assert.ok(view > indicator, 'Bank-link icon must be placed immediately before the View action button');
});

test('Clicking bank-link icon opens detail/linking flow without auto-linking or creating entries', () => {
  assert.match(source, /onClick=\{\(\) => \{\s*if \(expenseLinkStatus === 'linked' \|\| !canManage \|\| isCancelledPosting\) \{\s*void handleViewExpense\(expense\);\s*\} else \{\s*void handleEdit\(expense, true\);\s*\}\s*\}\}/);
});

test('Expense bank-link relies on canonical bank_statement_allocations and statement lines', () => {
  assert.match(source, /\.from\('bank_statement_allocations'\)[\s\S]{0,450}\.eq\('document_type', 'expense'\)[\s\S]{0,100}\.in\('document_id', chunk\)/);
  assert.match(source, /\.from\('bank_statement_lines'\)[\s\S]{0,450}\.in\('matched_expense_id', chunk\)/);
});
