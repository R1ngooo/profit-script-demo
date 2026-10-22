<script setup lang="ts">
import { computed } from 'vue'
import { feeAmount } from '@shared/types'
import type { FeeMode, PlatformFeeSetting } from '@shared/types'
import { useAppStore } from '@/stores/useAppStore'
import NumberField from '@/components/ui/NumberField.vue'
import { fmtInt, fmtMoney } from '@/utils/format'

type FeeItemKey = 'packaging' | 'shipping' | 'insurance'

const store = useAppStore()
const rows = computed(() => store.platforms)

const FEE_ITEMS: Array<{ key: FeeItemKey; label: string }> = [
  { key: 'packaging', label: '包装费' },
  { key: 'shipping', label: '运费' },
  { key: 'insurance', label: '运费险' },
]

function configFor(platform: string) {
  return (
    store.config?.platforms[platform] ?? {
      packaging: { mode: 'unit' as FeeMode, perUnit: 0, total: 0 },
      shipping: { mode: 'unit' as FeeMode, perUnit: 0, total: 0 },
      insurance: { mode: 'unit' as FeeMode, perUnit: 0, total: 0 },
      techFeeRate: 0,
      commercialInsuranceRate: 0,
    }
  )
}

function feeFor(platform: string, item: FeeItemKey): PlatformFeeSetting {
  return configFor(platform)[item]
}

function feeTotal(platform: string, item: FeeItemKey, settledQty: number): number {
  return feeAmount(feeFor(platform, item), settledQty)
}

function pctValue(rate: number): number {
  return Math.round(rate * 10000) / 100
}

function onModeChange(platform: string, item: FeeItemKey, mode: FeeMode) {
  store.setPlatformFee(platform, item, { mode })
}

function updateFeeValue(platform: string, item: FeeItemKey, mode: FeeMode, value: number | null) {
  store.setPlatformFee(platform, item, mode === 'total' ? { total: value ?? 0 } : { perUnit: value ?? 0 })
}

function updateRate(platform: string, field: 'techFeeRate' | 'commercialInsuranceRate', value: number | null) {
  store.setPlatformField(platform, field, (value ?? 0) / 100)
}
</script>

<template>
  <div class="subcard rate-form">
    <div class="subcard__head">
      <h3>分平台费率</h3>
      <span class="badge">包装费 · 运费 · 运费险 · 技术服务费 · 商业保险费</span>
      <span class="badge badge--brand">支持按件 / 按总额两种算法</span>
    </div>
    <p class="subcard__desc">
      包装费、运费、运费险可按「按件单价 × 结算商品数量」自动计算，也可直接填写总额；各平台独立设置，通过每项右侧下拉切换。修改后实时预览，点击面板右上角「提交并保存」写入配置。
    </p>

    <div class="rate-rows">
      <article
        v-for="row in rows"
        :key="row.platform"
        class="rate-row"
        :data-platform="row.platform"
      >
        <header class="rate-row__head">
          <strong>{{ row.platform }}</strong>
          <span class="badge">结算 {{ fmtMoney(row.settledSales) }}</span>
          <span class="badge">结算件数 {{ fmtInt(row.settledQty) }}</span>
        </header>

        <div class="fee-list">
          <div
            v-for="item in FEE_ITEMS"
            :key="item.key"
            class="fee-row"
            :data-item="item.key"
            :data-mode="feeFor(row.platform, item.key).mode"
          >
            <span class="fee-name">{{ item.label }}</span>
            <select
              class="fee-mode"
              :value="feeFor(row.platform, item.key).mode"
              :aria-label="`${row.platform} ${item.label} 计算方式`"
              @change="onModeChange(row.platform, item.key, ($event.target as HTMLSelectElement).value as FeeMode)"
            >
              <option value="unit">按件单价</option>
              <option value="total">按总额</option>
            </select>
            <NumberField
              v-if="feeFor(row.platform, item.key).mode === 'unit'"
              :model-value="feeFor(row.platform, item.key).perUnit"
              suffix="元/件"
              :min="0"
              :data-field="`${item.key}-per-unit`"
              @update:model-value="updateFeeValue(row.platform, item.key, 'unit', $event)"
              @commit="store.saveNow()"
            />
            <NumberField
              v-else
              :model-value="feeFor(row.platform, item.key).total"
              prefix="¥"
              :min="0"
              :data-field="`${item.key}-total`"
              @update:model-value="updateFeeValue(row.platform, item.key, 'total', $event)"
              @commit="store.saveNow()"
            />
            <span class="fee-total num">
              = {{ fmtMoney(feeTotal(row.platform, item.key, row.settledQty)) }}
              <em v-if="feeFor(row.platform, item.key).mode === 'unit'">（{{ fmtInt(row.settledQty) }} 件）</em>
            </span>
          </div>
        </div>

        <div class="rate-grid">
          <label class="rate-field">
            <span>技术服务费</span>
            <NumberField
              :model-value="pctValue(configFor(row.platform).techFeeRate)"
              suffix="%"
              :min="0"
              :max="100"
              @update:model-value="updateRate(row.platform, 'techFeeRate', $event)"
              @commit="store.saveNow()"
            />
          </label>
          <label class="rate-field">
            <span>商业保险费</span>
            <NumberField
              :model-value="pctValue(configFor(row.platform).commercialInsuranceRate)"
              suffix="%"
              :min="0"
              :max="100"
              @update:model-value="updateRate(row.platform, 'commercialInsuranceRate', $event)"
              @commit="store.saveNow()"
            />
          </label>
        </div>

        <footer class="rate-row__foot num">
          <span>包装费 {{ fmtMoney(row.packaging) }}</span>
          <span>运费 {{ fmtMoney(row.shipping) }}</span>
          <span>运费险 {{ fmtMoney(row.shippingInsurance) }}</span>
          <span>技术服务费 {{ fmtMoney(row.techFee) }}</span>
          <span>商业保险 {{ fmtMoney(row.commercialInsurance) }}</span>
          <span>达人佣金 {{ fmtMoney(row.commission) }}</span>
        </footer>
      </article>
    </div>
  </div>
</template>

<style scoped>
.rate-rows {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
  gap: 12px;
}

.rate-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 13px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--surface-solid);
}

.rate-row__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}

.fee-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.fee-row {
  display: grid;
  grid-template-columns: 52px 84px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
}

.fee-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-2);
  white-space: nowrap;
}

.fee-mode {
  height: 32px;
  padding: 0 6px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: var(--surface-solid);
  color: var(--text-2);
  font-size: 11.5px;
  font-weight: 600;
  outline: none;
  cursor: pointer;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}

.fee-mode:focus,
.fee-mode:hover {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.fee-total {
  grid-column: 1 / -1;
  justify-self: end;
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}

.fee-total em {
  font-style: normal;
  opacity: 0.85;
}

.rate-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.rate-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-3);
}

.rate-row__foot {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 10.5px;
  color: var(--text-3);
  border-top: 1px dashed var(--line);
  padding-top: 9px;
}

@media (max-width: 480px) {
  .rate-grid {
    grid-template-columns: 1fr;
  }
  .fee-row {
    grid-template-columns: 48px 78px minmax(0, 1fr);
  }
}
</style>
