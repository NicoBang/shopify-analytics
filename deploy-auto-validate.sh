#!/bin/bash

# Deploy Auto-Validate System
# Purpose: Deploy automated failed job validation

set -e

echo "🚀 Deploying auto-validate system..."
echo ""

# Deploy Edge Function
echo "1️⃣ Deploying auto-validate-failed-jobs Edge Function..."
npx supabase functions deploy auto-validate-failed-jobs --no-verify-jwt
echo ""

# Apply migration (setup cron job)
echo "2️⃣ Setting up cron job (daily at 2 AM)..."
psql "$DATABASE_URL" < supabase/migrations/20251013_setup_auto_validate_cron.sql
echo ""

echo "✅ Deployment complete!"
echo ""
echo "The system will now automatically:"
echo "  - Run daily at 2 AM"
echo "  - Validate all failed jobs"
echo "  - Mark empty days as completed"
echo "  - Preserve real failures"
echo ""
echo "To test manually: ./test-auto-validate.sh"
