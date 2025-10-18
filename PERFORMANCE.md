# Performance Guide - Shopify Analytics

## Timeout Issues & Solutions

### Problem
Google Sheets funktioner får 504 timeout når de kører Color/SKU/Number Analytics for lange datoperioder (>3 måneder).

### Root Cause
**Vercel Hobby Plan Limitation**: Serverless functions har **60 sekunders hard timeout**.

### Solutions

#### ✅ Option 1: Begræns datoperiode (Anbefalet for Hobby plan)
```
Max periode for Style Analytics: 90 dage (3 måneder)
Dashboard Analytics: Ingen limit (bruger chunking)
```

**Sådan gør du:**
1. Vælg **max 3 måneder** i B1/B2 cellerne
2. For længere analyser: Kør flere gange med forskellige perioder

#### ✅ Option 2: Upgrade til Vercel Pro ($20/måned)
**Fordele:**
- 5-minutter execution timeout (vs. 60 sekunder)
- Kan køre 6-12 måneders perioder uden problemer
- Ingen behov for manuel chunking

**Upgrade:**
```bash
vercel upgrade
```

#### ✅ Option 3: Manual Chunking (Google Sheets)
For >90 dages analyser på Hobby plan:

1. Opdel manuelt i 90-dages chunks:
   - Q1: 01/01 - 31/03
   - Q2: 01/04 - 30/06
   - Q3: 01/07 - 30/09
   - Q4: 01/10 - 31/12

2. Kør Color Analytics for hver periode
3. Export til CSV og sammenlæg i Excel/Google Sheets

### Technical Details

**Dashboard Analytics** (updateDashboard):
- ✅ Indbygget chunking for lange perioder
- ✅ Fungerer fint med >90 dages perioder
- API-kaldet opdelt i 90-dages chunks automatisk

**Style Analytics** (Color/SKU/Number):
- ❌ Ingen automatisk chunking (endnu)
- ⚠️ Vercel timeout efter 60 sekunder
- 📊 Typisk grænse: ~90 dage eller ~5000 SKUs

### Optimized Functions

✅ **Already optimized:**
- Dashboard (auto-chunking)
- Delivery Analytics (max 30 dage standard)

⚠️ **Needs manual period management:**
- Color Analytics
- SKU Analytics
- Number Analytics

### Future Improvements

**Potential solutions:**
1. Move Style Analytics til Supabase Edge Function (ingen timeout)
2. Implementer client-side pagination i Google Sheets
3. Cache product metadata i Sheets for genbrug
4. Pre-aggregate Style data dagligt via cron job

### Performance Benchmarks

| Function | Period | Records | Duration | Status |
|----------|--------|---------|----------|--------|
| Dashboard | 9 months | ~50K orders | ~15s (chunked) | ✅ OK |
| Color Analytics | 90 days | ~500 farver | ~45s | ✅ OK |
| Color Analytics | 9 months | ~800 farver | ~90s | ❌ TIMEOUT |
| SKU Analytics | 90 days | ~5K SKUs | ~50s | ✅ OK |
| SKU Analytics | 9 months | ~15K SKUs | ~120s | ❌ TIMEOUT |

### Recommendations by Use Case

**Daily/Weekly reporting:**
- ✅ Use 30-90 days periods (fast & reliable)

**Monthly/Quarterly reports:**
- ✅ Use max 90 days per API call
- ✅ Aggregate manually if needed

**Annual reports:**
- ⚠️ Requires Vercel Pro OR manual quarterly aggregation
- Alternative: Export rådata og analyser i BI-tool

## Quick Fixes

**If you get 504 timeout:**
1. Check your selected period in B1/B2
2. Reduce to max 90 days
3. Try again

**If data seems incomplete:**
1. Check console logs for partial results
2. Verify all sync jobs completed (`./check-sync-status.sh`)
3. Resync missing dates (`./sync-complete.sh <start> <end>`)
