const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_STRIP_RE = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

function generateCode(existingCodes) {
  let code;
  const existing = existingCodes || new Set();
  do {
    code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (existing.has(code));
  return code;
}

function isValidCode(code) {
  if (!code || code.length !== CODE_LENGTH) return false;
  for (const ch of code) {
    if (!CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

function sanitizeCodeInput(value) {
  if (!value) return '';
  return value.toUpperCase().replace(CODE_STRIP_RE, '').slice(0, CODE_LENGTH);
}

module.exports = { generateCode, isValidCode, sanitizeCodeInput, CODE_ALPHABET, CODE_LENGTH };
