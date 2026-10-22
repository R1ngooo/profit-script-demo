<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/useAppStore'
import SwitchToggle from '@/components/ui/SwitchToggle.vue'
import { fmtMoney, fmtPct } from '@/utils/format'

const store = useAppStore()

const rows = computed(() => store.adSpendRows)
const totalAll = computed(() => rows.value.reduce((sum, row) => sum + row.spend, 0))
const includedTotal = computed(() => store.totals?.adSpend ?? 0)

const excludeTest = computed({
  get: () => store.config?.filters.excludeTestOrders ?? true,
  set: (value: boolean) => store.setFilter('excludeTestOrders', value),
})

const includeAdOnly = computed({
  get: () => store.config?.filters.includeAdPlatformsWithoutOrders ?? false,
  set: (value: boolean) => store.setFilter('includeAdPlatformsWithoutOrders', value),
})

function share(spend: number): number | null {
  return totalAll.value > 0 ? spend / totalAll.value : null
}
</script>

<template>
  <div class="subcard">
    <div class="subcard__head">
      <h3>广告费</h3>
      <span class="badge">月消耗表 · 汇总</span>
    </div>
    <p class="subcard__desc">按「电商平台」字段汇总「消耗」；没有订单源的平台默认不计入毛利，避免只减广告费不确认收入。开关修改后实时预览，提交并保存后写入配置。</p>

    <div class="ad-toggles">
      <SwitchToggle
        v-model="excludeTest"
        label="排除刷单 / 测试订单"
        hint="视频号「刷单产品」等标记行不计入收入与成本"
      />
      <SwitchToggle
        v-model="includeAdOnly"
        label="并入无订单源平台广告费"
        hint="抖音、天猫、拼多多等无订单源平台"
      />
    </div>

    <div class="table-wrap ad-table">
      <table class="data">
        <thead>
          <tr>
            <th>平台</th>
            <th>消耗</th>
            <th>占广告费</th>
            <th>订单源</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.platform">
            <td class="platform-cell">{{ row.platform }}</td>
            <td>{{ fmtMoney(row.spend) }}</td>
            <td class="muted">{{ fmtPct(share(row.spend)) }}</td>
            <td>
              <span class="badge" :class="row.hasOrders ? 'badge--positive' : 'badge--warning'">
                {{ row.hasOrders ? '有订单源' : '无订单源' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="ad-foot num">
      <span>全部平台合计 <strong>{{ fmtMoney(totalAll) }}</strong></span>
      <span>计入毛利 <strong>{{ fmtMoney(includedTotal) }}</strong></span>
    </div>
  </div>
</template>

<style scoped>
.ad-toggles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 4px 18px;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  border: 1px dashed var(--line-strong);
}

.ad-table {
  max-height: 300px;
}

.ad-foot {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-3);
}

.ad-foot strong {
  color: var(--text);
}
</style>
