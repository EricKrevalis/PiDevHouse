export const requireEnv = (name: string): string => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} not set (copy .env.example to root .env)`);
  return v;
};
