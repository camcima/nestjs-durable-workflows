type StateValue = string | { [key: string]: StateValue };

export function flattenStateValue(value: StateValue): string {
  if (typeof value === 'string') return value;
  const [key, child] = Object.entries(value)[0];
  return `${key}.${flattenStateValue(child)}`;
}
