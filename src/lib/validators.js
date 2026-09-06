const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

// Accepts +country code and common separators (spaces, dashes, parens) —
// strips them, then requires 7-15 digits (ITU E.164 range) so legitimate
// international numbers pass while obvious garbage ("abc", "123") doesn't.
export function isValidPhone(value) {
  if (typeof value !== "string") return false;
  const digitsOnly = value.trim().replace(/[\s\-().]/g, "");
  return /^\+?[0-9]{7,15}$/.test(digitsOnly);
}
