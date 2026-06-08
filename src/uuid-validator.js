const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateUUID(uuid) {
  if (!uuid || typeof uuid !== 'string') {
    return false;
  }
  
  const trimmed = uuid.trim();
  if (trimmed.length === 0) {
    return false;
  }

  return UUID_REGEX.test(trimmed);
}

function sanitizeUUID(uuid) {
  if (!uuid || typeof uuid !== 'string') {
    return '';
  }

  if (!validateUUID(uuid)) {
    return '';
  }

  return uuid.trim().toLowerCase();
}

module.exports = { validateUUID, sanitizeUUID };