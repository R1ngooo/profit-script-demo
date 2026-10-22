<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/useAppStore'
import { fmtInt, fmtMoney } from '@/utils/format'

const store = useAppStore()
const platforms = computed(() => store.platforms)
const totalQty = computed(() => store.totals?.settledQty ?? 0)

/** 各平台订单源「商品数量」实际取用的字段 */
const QTY_FIELDS: Record<string, string> = {
  快手: '成交数量',
  视频号: '商品数量',
  抖音: '商品数量',
  天猫: '购买数量',
  拼多多: '商品数量(件)',
  京东: '订购数量',
  小红书: 'SKU件数',
}
</script>

<template>
  <div class="subcard basis">
    <div class="subcard__head">
      <h3>计费口径</h3>
      <span class="badge badge--brand">「件」= 结算商品数量</span>
    </div>
    <p class="subcard__desc">
      包装费、运费、运费险选择「按件单价」时，总额 =
      <strong>单价 × 结算商品数量</strong>；结算商品数量取各平台订单的<strong>商品数量</strong>字段，只统计「预估结算」订单，
      退款订单不计。也可以在下方「分平台费率」中把任意平台、任意一项切换为「按总额」直接填写金额。
    </p>

    <div class="basis-grid">
      <div v-for="platform in platforms" :key="platform.platform" class="basis-item">
        <span class="basis-platform">{{ platform.platform }}</span>
        <span class="basis-qty num">{{ fmtInt(platform.settledQty) }} 件</span>
        <span class="basis-field">来源：{{ QTY_FIELDS[platform.platform] ?? '商品数量' }}</span>
      </div>
    </div>

    <div class="basis-totals num">
      <span>合计结算件数 <strong>{{ fmtInt(totalQty) }}</strong> 件</span>
      <span>包装费合计 <strong>{{ fmtMoney(store.totals?.packaging ?? 0) }}</strong></span>
      <span>运费合计 <strong>{{ fmtMoney(store.totals?.shipping ?? 0) }}</strong></span>
      <span>运费险合计 <strong>{{ fmtMoney(store.totals?.shippingInsurance ?? 0) }}</strong></span>
    </div>
  </div>
</template>

<style scoped>
.basis-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
}

.basis-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface-solid);
}

.basis-platform {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-3);
}

.basis-qty {
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
}

.basis-field {
  font-size: 10px;
  color: var(--text-3);
}

.basis-totals {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px dashed var(--line);
  font-size: 11.5px;
  color: var(--text-3);
}

.basis-totals strong {
  color: var(--text);
}
</style>
