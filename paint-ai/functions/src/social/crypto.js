import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { secretValue } from '../config.js';
import { ProviderError } from '../lib/errors.js';

/**
 * AES-256-GCM for social access tokens stored in Firestore (collection social_tokens, never readable by
 * clients). The key is derived (HKDF) from the platform app secret kept in Secret Manager, so a database
 * export alone does not reveal usable tokens. Rotating the app secret means reconnecting the accounts.
 */
function key(secretName) {
  const secret = secretValue(secretName);
  if (!secret) throw new ProviderError('failed-precondition', `${secretName} is not configured.`);
  return Buffer.from(hkdfSync('sha256', secret, 'paint-ai', 'social-token-v1', 32));
}

export function sealToken(plain, secretName = 'INSTAGRAM_APP_SECRET') {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secretName), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function openToken(sealed, secretName = 'INSTAGRAM_APP_SECRET') {
  const [version, iv, tag, data] = String(sealed ?? '').split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new ProviderError('failed-precondition', 'Stored social token is invalid. Reconnect the account.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(secretName), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new ProviderError('failed-precondition', 'Stored social token cannot be decrypted (app secret changed?). Reconnect the account.');
  }
}
