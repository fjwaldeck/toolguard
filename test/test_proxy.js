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

const ENV_KEYS = ['DEV_MODE', 'WHOP_API_KEY'];
const envBaseline = {};
for (const name of ENV_KEYS) {
  envBaseline[name] = process.env[name];
}

function setEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function restoreEnv() {
  for (const name of ENV_KEYS) {
    setEnv(name, envBaseline[name]);
  }
}

function resetCache() {
  _cache.clear();
}

(async () => {
  try {
    resetCache();
    setEnv('DEV_MODE', undefined);
    setEnv('WHOP_API_KEY', undefined);

    // Missing key
    const noKey = await validateLicense(null);
    assert.strictEqual(noKey.valid, false);
    console.log('✓ Rejected missing license key');

    // Empty key
    const emptyKey = await validateLicense('   ');
    assert.strictEqual(emptyKey.valid, false);
    console.log('✓ Rejected blank license key');

    // tg_test_ key with DEV_MODE explicitly true
    setEnv('DEV_MODE', 'true');
    const testKey = await validateLicense('tg_test_123456');
    assert.strictEqual(testKey.valid, true);
    assert.strictEqual(testKey.tier, 'pro');
    assert.strictEqual(testKey.testMode, true);
    console.log('✓ Accepted tg_test_ key when DEV_MODE=true');

    // Cache hit
    assert.strictEqual(_cache.has('tg_test_123456'), true);
    console.log('✓ In-memory caching works');

    // tg_test_ key rejected when DEV_MODE is not true
    resetCache();
    setEnv('DEV_MODE', 'false');
    const testKeyDevOff = await validateLicense('tg_test_123456');
    assert.strictEqual(testKeyDevOff.valid, false);
    assert.match(testKeyDevOff.error, /WHOP_API_KEY/);
    console.log('✓ Rejected tg_test_ key when DEV_MODE=false');

    // Arbitrary key must never be granted pro by DEV_MODE=true
    resetCache();
    setEnv('DEV_MODE', 'true');
    const arbitraryDev = await validateLicense('live_key_abc123');
    assert.strictEqual(arbitraryDev.valid, false);
    assert.strictEqual(arbitraryDev.testMode, undefined);
    assert.match(arbitraryDev.error, /WHOP_API_KEY/);
    assert.strictEqual(_cache.has('live_key_abc123'), false);
    console.log('✓ Rejected arbitrary key with DEV_MODE=true');

    // Normal key with WHOP_API_KEY missing fails closed
    resetCache();
    setEnv('DEV_MODE', undefined);
    const normalNoConfig = await validateLicense('live_key_abc123');
    assert.strictEqual(normalNoConfig.valid, false);
    assert.match(normalNoConfig.error, /WHOP_API_KEY/);
    console.log('✓ Failed closed when WHOP_API_KEY is missing');
  } finally {
    restoreEnv();
    resetCache();
  }

  console.log('--- All Whop integration tests passed! ---');
})();
