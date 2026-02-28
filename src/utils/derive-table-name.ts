/**
 * Converts a PascalCase class name to a snake_case pluralized table name.
 * E.g., "OrderEntity" -> "order_entities", "OrderWorkflow" -> "order_workflows"
 */
export function deriveTableName(className: string): string {
  // PascalCase to snake_case
  const snakeCase = className
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');

  // Naive pluralization
  return naivePluralize(snakeCase);
}

function naivePluralize(word: string): string {
  if (word.endsWith('y')) {
    // Check if preceded by a vowel
    const beforeY = word[word.length - 2];
    if (beforeY && 'aeiou'.includes(beforeY)) {
      return word + 's';
    }
    return word.slice(0, -1) + 'ies';
  }
  if (
    word.endsWith('s') ||
    word.endsWith('x') ||
    word.endsWith('z') ||
    word.endsWith('ch') ||
    word.endsWith('sh')
  ) {
    return word + 'es';
  }
  return word + 's';
}
