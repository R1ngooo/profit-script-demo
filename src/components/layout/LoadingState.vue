<script setup lang="ts">
import type { RefreshStatus } from '@shared/types'

defineProps<{ refresh: RefreshStatus }>()
</script>

<template>
  <div class="loading">
    <div class="loading__card card">
      <div class="loading__pulse" aria-hidden="true" />
      <h2>正在解析订单与成本数据</h2>
      <p class="loading__step">
        {{ refresh.step || '初始化…' }}
        <span v-if="refresh.percent" class="num"> · {{ Math.round(refresh.percent) }}%</span>
      </p>
      <div class="loading__track"><span :style="{ width: `${Math.max(4, refresh.percent || 4)}%` }" /></div>
      <p class="loading__hint">首次解析 137MB 的视频号订单约需 20 秒，之后走本地缓存。</p>
    </div>

    <div class="loading__kpis">
      <div v-for="index in 5" :key="index" class="skeleton loading__kpi" />
    </div>

    <div class="loading__blocks">
      <div class="skeleton loading__block" />
      <div class="skeleton loading__block" />
    </div>
  </div>
</template>

<style scoped>
.loading {
  display: flex;
  flex-direction: column;
  gap: var(--grid-gap);
}

.loading__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 28px;
}

.loading__pulse {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--brand), var(--brand-2));
  animation: pulse-ring 1.8s infinite;
  margin-bottom: 6px;
}

.loading__card h2 {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.loading__step {
  font-size: 12.5px;
  color: var(--text-2);
}

.loading__track {
  width: 100%;
  height: 5px;
  border-radius: 999px;
  background: var(--line);
  overflow: hidden;
  margin: 6px 0;
}

.loading__track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand), var(--brand-2));
  transition: width 0.4s var(--ease-out);
}

.loading__hint {
  font-size: 11.5px;
  color: var(--text-3);
}

.loading__kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(212px, 1fr));
  gap: var(--grid-gap);
}

.loading__kpi {
  height: 116px;
  border-radius: var(--radius-lg);
}

.loading__blocks {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--grid-gap);
}

.loading__block {
  height: 320px;
  border-radius: var(--radius-lg);
}

@media (max-width: 900px) {
  .loading__blocks {
    grid-template-columns: 1fr;
  }
}
</style>
