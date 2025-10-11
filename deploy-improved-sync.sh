#!/bin/bash

# Deployment script for improved bulk-sync-orders
# Allows testing before production deployment

set -e

echo "🚀 Deploying improved bulk-sync-orders function"
echo "============================================="
echo ""

# Check if running in test mode
TEST_MODE=false
if [ "$1" = "--test" ]; then
    TEST_MODE=true
    echo "📝 Running in TEST MODE - will validate without deployment"
    echo ""
fi

# Validate shared utilities
echo "🔍 Validating shared utilities..."
REQUIRED_FILES=(
    "supabase/functions/_shared/config.ts"
    "supabase/functions/_shared/shopify.ts"
    "supabase/functions/_shared/supabase.ts"
    "supabase/functions/_shared/types.ts"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✅ $file"
    else
        echo "  ❌ Missing: $file"
        exit 1
    fi
done

echo ""
echo "✅ All shared utilities are in place"
echo ""

# Type check
echo "🔍 Running TypeScript type checking..."
if command -v deno &> /dev/null; then
    deno check supabase/functions/bulk-sync-orders/index.ts
    echo "✅ Type checking passed"
else
    echo "⚠️  Deno not installed - skipping type check"
fi

echo ""

if [ "$TEST_MODE" = true ]; then
    echo "🧪 Running test suite..."
    # Export vars from .env.local for the test
    if [ -f ".env.local" ]; then
        set -a
        source .env.local
        set +a
    fi
    node test-improved-sync.js

    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ All tests passed!"
        echo ""
        echo "Ready for production deployment. Run without --test flag to deploy:"
        echo "  ./deploy-improved-sync.sh"
    else
        echo ""
        echo "❌ Tests failed. Please fix issues before deployment."
        exit 1
    fi
else
    echo "📦 Deploying to Supabase..."
    echo ""

    # Deploy the function
    npx supabase functions deploy bulk-sync-orders --no-verify-jwt

    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ Function deployed successfully!"
        echo ""
        echo "You can now test the deployed function with:"
        echo "  node test-improved-sync.js"
        echo ""
        echo "Or run a production sync with:"
        echo "  ./sync-complete.sh 2025-10-01 2025-10-07"
    else
        echo ""
        echo "❌ Deployment failed. Please check the error messages above."
        exit 1
    fi
fi

echo ""
echo "📊 Improvements Summary:"
echo "  • Separated concerns (orders only, no SKUs)"
echo "  • Shared utilities for code reuse"
echo "  • Proper TypeScript interfaces"
echo "  • Test mode for safe validation"
echo "  • Improved error handling with retry logic"
echo "  • Cleaner, more maintainable code structure"
echo ""