import { deriveTableName } from '../../src/utils/derive-table-name';

describe('deriveTableName', () => {
  it('should convert PascalCase class name ending in Entity', () => {
    expect(deriveTableName('OrderEntity')).toBe('order_entities');
  });

  it('should convert PascalCase class name ending in Workflow', () => {
    expect(deriveTableName('OrderWorkflow')).toBe('order_workflows');
  });

  it('should handle single-word class names', () => {
    expect(deriveTableName('Order')).toBe('orders');
  });

  it('should handle multi-word PascalCase', () => {
    expect(deriveTableName('ShippingLabel')).toBe('shipping_labels');
  });

  it('should handle class names ending in y (naive pluralization)', () => {
    expect(deriveTableName('OrderEntry')).toBe('order_entries');
  });

  it('should handle class names ending in s', () => {
    expect(deriveTableName('OrderStatus')).toBe('order_statuses');
  });

  it('should handle class names ending in x', () => {
    expect(deriveTableName('OrderBox')).toBe('order_boxes');
  });
});
