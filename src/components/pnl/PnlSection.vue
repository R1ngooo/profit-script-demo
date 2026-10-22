<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PRODUCT_COST_RATIO_BENCHMARK, productCostRatio, refundRatio } from '@shared/types'
import { useAppStore } from '@/stores/useAppStore'
import SectionCard from '@/components/layout/SectionCard.vue'
import WaterfallChart from './WaterfallChart.vue'
import PlatformTable from './PlatformTable.vue'
import FieldOrderPopover from './FieldOrderPopover.vue'
import { fmtInt, fmtPct } from '@/utils/format'

const store = useAppStore()
const selected = ref('合计')

const options = computed(() => ['合计', ...store.platforms.map((pnl) => pnl.platform)])

watch(
  options,
  (list) => {
    if (!list.includes(selected.value)) selected.value = list[0]
  },
  { immediate: true },
)

const pnl = computed(() =>
  selected.value === '合计' ? store.totals : (store.platforms.find((item) => item.platform === selected.value) ?? store.totals),
)

const costRatio = computed(() => (pnl.value ? productCostRatio(pnl.value) : null))
const costRatioLow = computed(() => costRatio.value !== null && costRatio.value < PRODUCT_COST_RATIO_BENCHMARK)
const refundPct = computed(() => (pnl.value ? refundRatio(pnl.value) : null))
</script>

<template>
  <SectionCard
    index="Ⅱ"
    title="毛利结构"
    sub="预估结算金额 − 产品成本 − 包装费 − 运费 − 运费险 − 平台技术服务费 − 商业保险费 − 达人佣金 − 广告费 = 粗算毛利"
  >
    <template #title-extra>
      <span v-if="pnl" class="badge">成本覆盖率 {{ fmtPct(pnl.costCoverage) }}</span>
      <span v-if="store.missingCosts.length" class="badge badge--warning">{{ store.missingCosts.length }} 个 SKU 缺成本</span>
      <span class="badge" :class="{ 'badge--warning': costRatioLow }">
        产品成本费比 {{ fmtPct(costRatio) }}
        <template v-if="costRatioLow">（低于 30%）</template>
      </span>
      <span class="badge">退款比例 {{ fmtPct(refundPct) }}</span>
    </template>
    <template #actions>
      <div class="segmented" role="tablist" aria-label="毛利视图切换">
        <button
          v-for="name in options"
          :key="name"
          type="button"
          role="tab"
          :aria-selected="name === selected"
          :class="{ 'is-active': name === selected }"
          @click="selected = name"
        >
          {{ name }}
        </button>
      </div>
      <FieldOrderPopover />
    </template>

    <div v-if="pnl" class="pnl-chart">
      <WaterfallChart :pnl="pnl" />
      <div class="pnl-facts">
        <span>结算件数 <strong class="num">{{ fmtInt(pnl.settledQty) }}</strong></span>
        <span>结算行 <strong class="num">{{ fmtInt(pnl.settleRows) }}</strong></span>
        <span>退款行 <strong class="num">{{ fmtInt(pnl.refundRows) }}</strong></span>
        <span>
          产品成本费比
          <strong class="num" :class="{ 'is-warn-text': costRatioLow }">{{ fmtPct(costRatio) }}</strong>
          <em v-if="costRatioLow" class="ratio-warn">低于 30% 参考线</em>
        </span>
        <span>退款比例 <strong class="num">{{ fmtPct(refundPct) }}</strong></span>
      </div>
    </div>

    <PlatformTable :platforms="store.platforms" :totals="store.totals" />
  </SectionCard>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  padding: 3px;
  border-radius: 11px;
  background: var(--surface-muted);
  border: 1px solid var(--line);
  gap: 2px;
  flex-wrap: wrap;
}

.segmented button {
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  transition: all 0.16s var(--ease-out);
}

.segmented button:hover {
  color: var(--text);
}

.segmented button.is-active {
  background: var(--surface-solid);
  color: var(--text);
  box-shadow: var(--shadow-xs);
}

.pnl-chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 6px 0;
  border-radius: var(--radius-md);
  background: var(--surface-muted);
}

.pnl-facts {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 11.5px;
  color: var(--text-3);
  padding: 0 12px 10px;
}

.pnl-facts strong {
  color: var(--text-2);
}

.pnl-facts strong.is-warn-text {
  color: var(--warning);
}

.ratio-warn {
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 5px;
  font-style: normal;
  font-size: 10px;
  font-weight: 700;
  color: var(--warning);
  background: var(--warning-soft);
}
</style>
