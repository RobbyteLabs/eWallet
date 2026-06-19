import type {
  AppData,
  CreditCard,
  Expense,
  Income,
  Loan,
  MonthlyReport,
  PaymentDue,
} from "../types";
import { monthKey, todayIso } from "./format";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const dateFromDay = (day: number, base = new Date()) => {
  const safeDay = Math.min(Math.max(day, 1), 31);
  const date = new Date(base.getFullYear(), base.getMonth(), safeDay);
  if (date.getMonth() !== base.getMonth()) {
    date.setDate(0);
  }
  return date.toISOString().slice(0, 10);
};

export const monthKeyFromIso = (date?: string, fallback = monthKey()) =>
  date && isoDatePattern.test(date) ? date.slice(0, 7) : fallback;

const dateInMonth = (date: string | undefined, targetMonth: string) =>
  Boolean(date && date.startsWith(targetMonth));

const formatLocalIsoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

export const addMonthsToIsoDate = (
  date: string,
  months = 1,
  preferredDay?: number,
) => {
  const [year, month, day] = isoDatePattern.test(date)
    ? date.split("-").map(Number)
    : todayIso().split("-").map(Number);
  const target = new Date(year, month - 1 + months, 1);
  const lastDayOfTargetMonth = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(
    Math.min(
      Math.max(preferredDay || day || 1, 1),
      lastDayOfTargetMonth,
    ),
  );
  return formatLocalIsoDate(target);
};

export const isExpenseInMonth = (
  expense: Expense,
  targetMonth = monthKey(),
) =>
  expense.frequency === "once"
    ? dateInMonth(expense.date, targetMonth)
    : true;

export const isIncomeInMonth = (income: Income, targetMonth = monthKey()) =>
  income.recurring || dateInMonth(income.date, targetMonth);

export const isExpensePaidForMonth = (
  expense: Expense,
  targetMonth = monthKey(),
) =>
  expense.frequency === "once"
    ? expense.paid
    : expense.lastPaidMonth === targetMonth;

export const isLoanPaidForMonth = (loan: Loan, targetMonth = monthKey()) =>
  loan.lastPaidMonth === targetMonth;

export const isCardPaidForMonth = (
  card: CreditCard,
  targetMonth = monthKey(),
) => Boolean(card.lastPaymentDate?.startsWith(targetMonth));

export const getMonthlyCardPayment = (card: CreditCard) =>
  card.purchases.reduce((sum, purchase) => {
    const pendingInstallments = Math.max(
      purchase.installments - purchase.paidInstallments,
      0,
    );
    if (pendingInstallments === 0) return sum;
    return sum + purchase.amount / Math.max(purchase.installments, 1);
  }, 0);

export const getUsedCardLimit = (card: CreditCard) =>
  card.purchases.reduce((sum, purchase) => {
    const pendingRatio =
      Math.max(purchase.installments - purchase.paidInstallments, 0) /
      Math.max(purchase.installments, 1);
    return sum + purchase.amount * pendingRatio;
  }, 0);

const expenseDue = (expense: Expense): string => {
  if (expense.frequency === "once" && expense.date) return expense.date;
  return dateFromDay(expense.dueDay ?? 1);
};

export const getPaymentDues = (data: AppData): PaymentDue[] => {
  const today = todayIso();
  const currentMonth = monthKey();
  const expenseDues: PaymentDue[] = data.expenses.map((expense) => {
    const dueDate = expenseDue(expense);
    return {
      id: `expense-${expense.id}`,
      label: expense.name,
      source: "expense",
      amount: expense.amount,
      dueDate,
      status: isExpensePaidForMonth(expense, currentMonth)
        ? "paid"
        : dueDate < today
          ? "overdue"
          : "due",
    };
  });

  const loanDues: PaymentDue[] = data.loans.map((loan) => {
    const dueDate = loan.nextDueDate || dateFromDay(loan.dueDay);
    const dueMonth = monthKeyFromIso(dueDate);
    return {
      id: `loan-${loan.id}`,
      label: loan.lender,
      source: "loan",
      amount: loan.monthlyPayment,
      dueDate,
      status: isLoanPaidForMonth(loan, dueMonth)
        ? "paid"
        : dueDate < today
          ? "overdue"
          : "due",
    };
  });

  const cardDues: PaymentDue[] = data.cards.map((card) => {
    const dueDate = dateFromDay(card.paymentDay);
    const payment = getMonthlyCardPayment(card);
    return {
      id: `card-${card.id}`,
      label: card.name,
      source: "card",
      amount: payment,
      dueDate,
      status:
        payment === 0 || isCardPaidForMonth(card, currentMonth)
          ? "paid"
          : dueDate < today
            ? "overdue"
            : "due",
    };
  });

  return [...expenseDues, ...loanDues, ...cardDues].sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate),
  );
};

export const getMonthlyReport = (data: AppData): MonthlyReport => {
  const currentMonth = monthKey();
  const fixedExpenses = data.expenses
    .filter(
      (expense) =>
        expense.kind === "fixed" && isExpenseInMonth(expense, currentMonth),
    )
    .reduce((sum, expense) => sum + expense.amount, 0);
  const variableExpenses = data.expenses
    .filter(
      (expense) =>
        expense.kind === "variable" && isExpenseInMonth(expense, currentMonth),
    )
    .reduce((sum, expense) => sum + expense.amount, 0);
  const loanPayments = data.loans.reduce(
    (sum, loan) => sum + loan.monthlyPayment,
    0,
  );
  const cardPayments = data.cards.reduce(
    (sum, card) => sum + getMonthlyCardPayment(card),
    0,
  );
  const trackedIncome = data.incomes
    .filter((income) => isIncomeInMonth(income, currentMonth))
    .reduce((sum, income) => sum + income.amount, 0);
  const income = data.settings.monthlyIncome + trackedIncome;

  return {
    monthKey: currentMonth,
    income,
    fixedExpenses,
    variableExpenses,
    loanPayments,
    cardPayments,
    available:
      income - fixedExpenses - variableExpenses - loanPayments - cardPayments,
  };
};

export const getUpcomingAlerts = (data: AppData) => {
  const today = new Date(`${todayIso()}T12:00:00`);
  const max = new Date(today);
  max.setDate(today.getDate() + data.settings.alertDaysBefore);

  return getPaymentDues(data).filter((due) => {
    if (due.status === "paid") return false;
    const dueDate = new Date(`${due.dueDate}T12:00:00`);
    return dueDate <= max;
  });
};

export const groupAmounts = <T>(
  items: T[],
  getKey: (item: T) => string | undefined,
  getAmount: (item: T) => number,
) =>
  items
    .reduce<Array<{ label: string; amount: number }>>((totals, item) => {
      const label = getKey(item) || "Sin clasificar";
      const current = totals.find((entry) => entry.label === label);
      if (current) {
        current.amount += getAmount(item);
      } else {
        totals.push({ label, amount: getAmount(item) });
      }
      return totals;
    }, [])
    .sort((a, b) => b.amount - a.amount);

export const getExpenseCategoryTotals = (data: AppData) =>
  groupAmounts(
    data.expenses.filter((expense) => isExpenseInMonth(expense)),
    (expense) => expense.category,
    (expense) => expense.amount,
  );

export const getIncomeCategoryTotals = (data: AppData) =>
  [
    ...(data.settings.monthlyIncome > 0
      ? [{ label: "Ingreso base", amount: data.settings.monthlyIncome }]
      : []),
    ...groupAmounts(
      data.incomes.filter((income) => isIncomeInMonth(income)),
      (income) => income.category,
      (income) => income.amount,
    ),
  ].sort((a, b) => b.amount - a.amount);

export const getExpensePriorityTotals = (data: AppData) =>
  groupAmounts(
    data.expenses.filter((expense) => isExpenseInMonth(expense)),
    (expense) => expense.priority || "essential",
    (expense) => expense.amount,
  );
