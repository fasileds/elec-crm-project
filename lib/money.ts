export function formatMoney(cents: number | null | undefined, currency: string, locale: string) {
  if (cents == null) return "—";
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function parseMoneyToCents(input: string) {
  const normalized = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}
