<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/useAppStore'
import KpiCard from '@/components/ui/KpiCard.vue'
import { fmtInt, fmtMoney, fmtPct } from '@/utils/format'

const store = useAppStore()
const totals = computed(() => store.totals)
const missingSkuCount = computed(() => store.missingCosts.length)

const adRatio = computed(() => {
  const pnl = totals.value
  if (!pnl || !pnl.settledSales) return null
  return pnl.adSpend / pnl.settledSales
})

const adRoi = computed(() => {
  const pnl = totals.value
  if (!pnl || !pnl.adSpend) return null
  return pnl.settledSales / pnl.adSpend
})

const refundRatio = computed(() => {
  const pnl = totals.value
  if (!pnl) return null
  const gross = pnl.settledSales + pnl.refundSales
  return gross > 0 ? pnl.refundSales / gross : null
})

function goToMissingCosts() {
  document.getElementById('missing-costs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="kpi-row">
    <KpiCard
      label="预估结算金额"
      :value="totals?.settledSales ?? null"
      :meta="`结算 ${fmtInt(totals?.settledQty ?? 0)} 件`"
      :hint="`退款 ${fmtMoney(totals?.refundSales ?? 0)}`"
    />
    <KpiCard
      label="粗算毛利"
      :value="totals?.grossProfit ?? null"
      tone="auto"
      :meta="`毛利率 ${fmtPct(totals?.grossMargin ?? null)}`"
      :hint="`已扣 ${fmtInt(totals?.settledQty ?? 0)} 件成本与广告费`"
    />
    <KpiCard
      label="广告费"
      :value="totals?.adSpend ?? null"
      :meta="`占结算额 ${fmtPct(adRatio)}`"
      :hint="adRoi ? `ROI ${adRoi.toFixed(2)}` : '—'"
    />
    <KpiCard
      label="退款金额"
      :value="totals?.refundSales ?? null"
      :meta="`退款占比 ${fmtPct(refundRatio)}`"
      :hint="`${fmtInt(totals?.refundRows ?? 0)} 行退款`"
    />
    <KpiCard
      label="缺失成本 SKU"
      :value="missingSkuCount"
      format="int"
      :meta="`涉及 ${fmtInt(totals?.missingCostQty ?? 0)} 件`"
      :hint="`去补录 →`"
      clickable
      @click="goToMissingCosts"
    />
  </div>
</template>

<style scoped>
.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--grid-gap);
}
</style>
