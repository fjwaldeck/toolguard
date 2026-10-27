const assert = require('assert');
const { repairJson } = require('../src/repair');

console.log('--- Running ToolGuard Unit Tests ---');

// Test 1: Valid JSON
const valid = '{"success": true, "tokens": 120}';
assert.deepStrictEqual(repairJson(valid), { success: true, tokens: 120 });
console.log('✓ Valid JSON passed');

// Test 2: Trailing comma
const trailing = '{"items": [1, 2, 3,], "total": 3,}';
assert.deepStrictEqual(repairJson(trailing), { items: [1, 2, 3], total: 3 });
console.log('✓ Trailing commas healed');

// Test 3: Markdown code blocks
const markdownWrapped = '```json\n{"weather": "sunny", "temp": 24}\n```';
assert.deepStrictEqual(repairJson(markdownWrapped), { weather: 'sunny', temp: 24 });
console.log('✓ Markdown block stripping healed');

// Test 4: Truncated JSON (unclosed braces/brackets)
const truncated = '{"user": {"name": "FJ", "role": "builder"';
assert.deepStrictEqual(repairJson(truncated), { user: { name: 'FJ', role: 'builder' } });
console.log('✓ Truncated braces auto-closure healed');

console.log('All tests passed successfully!');

// Whop License Tests
const { validateLicense, _cache } = require('../src/whop');

(async () => {
  // Test missing key
  const noKey = await validateLicense(null);
  assert.strictEqual(noKey.valid, false);
  console.log('✓ Rejected missing license key');

  // Test dev test key
  const testKey = await validateLicense('tg_test_123456');
  assert.strictEqual(testKey.valid, true);
  assert.strictEqual(testKey.tier, 'pro');
  console.log('✓ Accepted test key in dev mode');

  // Test cache hit
  assert.strictEqual(_cache.has('tg_test_123456'), true);
  console.log('✓ In-memory caching works');

  console.log('--- All Whop integration tests passed! ---');
})();
