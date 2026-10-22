<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/useAppStore'
import { fmtInt, fmtMoney, fmtPct } from '@/utils/format'

const store = useAppStore()

const commission = computed(() => store.summary?.commission ?? null)
const rows = computed(() => commission.value?.byPlatform ?? [])
const files = computed(() => (commission.value?.files ?? []).filter((file) => file.rows > 0))

const matchRate = computed(() => {
  const stats = commission.value
  if (!stats || !stats.totalAmount) return null
  return stats.matchedAmount / stats.totalAmount
})
</script>

<template>
  <div class="subcard commission">
    <div class="subcard__head">
      <h3>商务订单 · 达人佣金</h3>
      <span class="badge badge--brand">{{ fmtInt(commission?.totalRecords ?? 0) }} 条记录</span>
      <span class="badge">{{ files.length }} 个文件</span>
      <span v-if="commission?.leaderFeeRecords" class="badge badge--warning">
        团长服务费 {{ commission.leaderFeeRecords }} 条已忽略
      </span>
    </div>
    <p class="subcard__desc">
      自动读取 excel/商务订单 下按平台命名的文件，按「订单号（快手/视频号行级 + SKU，抖音订单级）」匹配订单；<strong>只有预估结算的订单才会产生达人佣金</strong>，退款订单不计，无需手工填写。
    </p>

    <div class="commission-summary">
      <div class="commission-cell">
        <span>佣金总额（预估）</span>
        <strong class="num">{{ fmtMoney(commission?.totalAmount ?? 0) }}</strong>
      </div>
      <div class="commission-cell">
        <span>计入毛利（仅结算订单）</span>
        <strong class="num money--pos">{{ fmtMoney(commission?.matchedAmount ?? 0) }}</strong>
      </div>
      <div class="commission-cell">
        <span>退款订单不计</span>
        <strong class="num muted">{{ fmtMoney(commission?.refundAmount ?? 0) }}</strong>
      </div>
      <div class="commission-cell">
        <span>未匹配 / 佣金匹配率</span>
        <strong class="num">
          {{ fmtInt(commission?.unmatchedRecords ?? 0) }} 条
          <em class="muted">（{{ fmtPct(matchRate) }}）</em>
        </strong>
      </div>
    </div>

    <div class="table-wrap commission-table">
      <table class="data">
        <thead>
          <tr>
            <th>平台</th>
            <th>佣金记录</th>
            <th>佣金总额</th>
            <th>计入毛利</th>
            <th>退款不计</th>
            <th>未匹配</th>
            <th>计入条数</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.platform">
            <td class="platform-cell">{{ row.platform }}</td>
            <td>{{ fmtInt(row.records) }}</td>
            <td>{{ fmtMoney(row.amount) }}</td>
            <td class="money--pos">{{ fmtMoney(row.matchedAmount) }}</td>
            <td class="muted">{{ fmtMoney(row.refundAmount) }}</td>
            <td :class="{ 'money--neg': row.unmatchedRecords }">{{ fmtInt(row.unmatchedRecords) }}</td>
            <td>{{ fmtInt(row.matchedRecords) }}</td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="7" class="muted">未读取到商务订单佣金数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="commission?.warnings?.length" class="commission-warnings">
      <p v-for="(warning, index) in commission.warnings" :key="index">{{ warning }}</p>
    </div>

    <div class="commission-files">
      <span v-for="file in files" :key="file.path" class="badge" :class="{ 'badge--negative': file.error }">
        {{ file.name }} · {{ fmtInt(file.rows) }} 行
      </span>
    </div>
  </div>
</template>

<style scoped>
.commission-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.commission-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--surface-solid);
  font-size: 11px;
  color: var(--text-3);
}

.commission-cell strong {
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.01em;
}

.commission-cell em {
  font-style: normal;
  font-size: 11px;
  font-weight: 600;
}

.commission-table {
  max-height: 300px;
}

.commission-warnings {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 11.5px;
}

.commission-files {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.commission-files .badge {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
