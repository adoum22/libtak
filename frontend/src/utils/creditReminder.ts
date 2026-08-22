export const getCreditAgeInDays = (iso: string, now = Date.now()) => {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor((now - timestamp) / 86_400_000));
};

export const normalizeWhatsAppPhone = (phone: string) => {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `212${digits.slice(1)}`;
  else if (digits.length === 9) digits = `212${digits}`;
  return digits;
};

export const buildWhatsAppReminderUrl = (phone: string, message: string) => {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  if (!normalizedPhone) return null;
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
};
