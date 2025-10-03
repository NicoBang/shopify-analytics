# Analytics Test Suite

Automated tests for Shopify Analytics system to ensure data consistency and catch divergence early.

## Test Structure

```
tests/
├── analytics/
│   └── reconciliation.test.js   # Dashboard vs Color_Analytics reconciliation
├── setup.js                      # Jest test setup
└── README.md                     # This file
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:reconciliation

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Test Suites

### Analytics Reconciliation (`reconciliation.test.js`)

**Purpose**: Automatic comparison of calculations between Dashboard and Color_Analytics to ensure data consistency.

**Test Requirements**:
- **Bruttoomsætning**: Difference ≤ 0.1%
- **Antal stk Brutto**: Must match 100% (no tolerance)
- **Returer**: Difference ≤ 1 unit (tolerance for edge cases)

**Test Periods**:
- Single Day: 2024-10-09 (known discrepancy)
- Week: 2024-10-01 to 2024-10-09
- Full Month: October 2024
- Empty Period: 2023-01-01 (no orders expected)

**Edge Cases**:
- Order with partial cancellation (order_id: 6667277697291)
- Period with thousands of orders (performance check)
- Empty period (should return 0 in both systems)

## Known Issues

### Dashboard Proportional Cancellation (Expected Failure)

**Issue**: Dashboard uses proportional cancellation estimation which is mathematically incorrect when items have different prices.

**Example**: Order with 2 items (799 kr + 249 kr), 1 cancelled:
- Dashboard: Subtracts average price (524 kr)
- Correct (SKU-level): Subtracts actual cancelled item price (799 kr or 249 kr)

**Result**: Dashboard shows 9.1% discrepancy compared to Color_Analytics on 2024-10-09.

**Status**: Documented in CLAUDE.md section "[Dato: 2025-10-03] – Dashboard vs Color_Analytics Reconciliation"

**Recommendation**: Fix Dashboard to use SKU-level data (see Option 1 in CLAUDE.md)

## Environment Variables

Required environment variables (from `.env` file):

```bash
API_BASE_URL=https://shopify-analytics-nu.vercel.app/api
API_SECRET_KEY=bda5da3d49fe0e7391fded3895b5c6bc
```

## Test Output

### Success Example
```
PASS  tests/analytics/reconciliation.test.js
  Dashboard vs Color_Analytics Reconciliation
    Known Test Period (2024-10-09)
      ✓ should have known Dashboard bruttoomsætning (49,736.42 kr)
      ✓ should have known Color_Analytics bruttoomsætning (45,205.35 kr)
      ✓ should detect known discrepancy in bruttoomsætning (9.1%)
      ✓ antal stk brutto should match perfectly (250 stk)
```

### Failure Example
```
FAIL  tests/analytics/reconciliation.test.js
  Dashboard vs Color_Analytics Reconciliation
    Week Period (2024-10-01 to 2024-10-09)
      ✕ bruttoomsætning should be within tolerance

      Mismatch in bruttoomsætning:
        Dashboard: 123,456.78
        Color_Analytics: 111,111.11
        Difference: 10.0
        Tolerance: 0.1%
```

## Adding New Tests

1. Create test file in appropriate directory
2. Follow naming convention: `*.test.js`
3. Use `describe()` and `test()` blocks
4. Add tolerances and assertions
5. Document expected failures in `Known Issues` section
6. Update this README

## Continuous Integration

These tests should be run:
- Before every deployment
- After database schema changes
- After API endpoint changes
- Weekly as regression test

## Troubleshooting

### Tests Timeout
- Increase timeout in `jest.config.js`
- Check API availability
- Verify network connection

### API Errors
- Verify `API_SECRET_KEY` in `.env`
- Check API endpoint URLs
- Confirm API is deployed and accessible

### Data Mismatch
- Verify test period has expected data
- Check if data was re-synced
- Review CLAUDE.md for known issues

## References

- Analysis: CLAUDE.md section "[Dato: 2025-10-03] – Dashboard vs Color_Analytics Reconciliation"
- Dashboard Code: `google-sheets-enhanced.js:130-175`
- Color_Analytics API: `api/metadata.js:895-927`
- Test Configuration: `jest.config.js`
