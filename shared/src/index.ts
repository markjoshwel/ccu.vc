export const greet = (name: string): string => {
  return `Hello, ${name}!`;
};

export type { GreetOptions };

interface GreetOptions {
  name: string;
  uppercase?: boolean;
}
