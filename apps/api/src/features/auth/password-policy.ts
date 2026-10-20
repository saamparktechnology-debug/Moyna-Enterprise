import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@erp/contracts';
import type { ErrorDetail } from '@erp/contracts';

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  'password12345',
  'passw0rd1234',
  'p@ssw0rd1234',
  'qwerty',
  'qwertyuiop',
  'qwertyuiop12',
  'qwerty123456',
  'qwertyuiopas',
  'asdfghjkl',
  'asdfghjkl123',
  'zxcvbnm',
  'zxcvbnm12345',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  '123456789012',
  '1234567890123',
  '111111111111',
  '000000000000',
  'abcdefghijkl',
  'abcd12345678',
  'iloveyou',
  'iloveyou1234',
  'letmein',
  'letmein12345',
  'welcome',
  'welcome1234',
  'welcome12345',
  'welcome123456',
  'administrator',
  'administrator1',
  'admin',
  'admin123',
  'admin1234',
  'admin12345',
  'admin123456',
  'adminadmin12',
  'changeme',
  'changeme123',
  'changeme1234',
  'changeme12345',
  'changeme-before',
  'changemebeforefirstuse',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'batman',
  'trustno1',
  'master',
  'shadow',
  'michael',
  'jennifer',
  'hunter',
  'whatever',
  'freedom',
  'secret',
  'secret123456',
  'login',
  'login123456',
  'default',
  'default12345',
  'test',
  'test123456789',
  'testing12345',
  'guest',
  'guest1234567',
  'user',
  'user12345678',
  'root',
  'rootroot1234',
  'india',
  'india123456',
  'india@123456',
  'mumbai',
  'delhi',
  'kolkata',
  'bharat',
  'bharat123456',
  'jaihind',
  'jaihind1234',
  'ramram',
  'omnamah',
  'shiva',
  'krishna',
  'krishna1234',
  'ganesh',
  'ganesh12345',
  'ganesha1234',
  'hello',
  'hello123456',
  'hellohello12',
  'company',
  'company1234',
  'company12345',
  'business',
  'business1234',
  'toto',
  'toto12345678',
  'erickshaw',
  'erickshaw123',
  'battery',
  'battery1234',
  'superadmin',
  'superadmin12',
  'superadmin123',
  'superadmin1234',
  'superadmin12345',
  'passwordpassword',
  'passwordpass1',
  'qazwsxedc123',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  'q1w2e3r4t5y6',
  'abc123abc123',
  'aaaaaaaaaaaa',
  'a1b2c3d4e5f6',
]);

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isRepetitiveOrSequential(value: string): boolean {
  const compact = normalise(value);
  if (compact.length === 0) return true;
  if (new Set(compact).size <= 3) return true;
  const sequence =
    '0123456789012345678901234567890abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';
  return (
    compact.length >= 8 &&
    (sequence.includes(compact) || sequence.includes([...compact].reverse().join('')))
  );
}

export interface PasswordPolicyInput {
  password: string;
  username: string;
  email: string;
  currentPassword?: string;
}

export function checkPasswordPolicy(input: PasswordPolicyInput): ErrorDetail[] {
  const problems: string[] = [];
  const { password } = input;
  if (password.length < PASSWORD_MIN_LENGTH)
    problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters`);
  if (password.length > PASSWORD_MAX_LENGTH)
    problems.push(`Use at most ${PASSWORD_MAX_LENGTH} characters`);
  if (problems.length === 0) {
    const normalised = normalise(password);
    const emailName = normalise(input.email.split('@')[0] ?? '');
    const username = normalise(input.username);
    if (COMMON_PASSWORDS.has(normalised) || COMMON_PASSWORDS.has(password.toLowerCase())) {
      problems.push('This password is too common. Choose something harder to guess');
    } else if (isRepetitiveOrSequential(password)) {
      problems.push('Avoid repeated characters and simple sequences');
    }
    if (
      (username.length >= 3 && normalised.includes(username)) ||
      (emailName.length >= 3 && normalised.includes(emailName))
    ) {
      problems.push('The password must not contain your username or email name');
    }
    if (input.currentPassword !== undefined && password === input.currentPassword) {
      problems.push('Choose a password different from the current one');
    }
  }
  return problems.map((message) => ({ field: 'newPassword', message }));
}
