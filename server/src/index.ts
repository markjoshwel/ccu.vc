import { greet } from '../../shared/src';

export const handler = (): string => {
  return greet('Server');
};
