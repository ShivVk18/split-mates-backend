import { randomBytes } from 'crypto';

const generateToken = () => {
  return randomBytes(32).toString('hex');
};

export {generateToken}