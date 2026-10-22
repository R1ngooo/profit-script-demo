<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/useAppStore'
import { fmtInt, fmtSeconds, fmtTime } from '@/utils/format'

const store = useAppStore()

const subtitle = computed(() => {
  const summary = store.summary
  if (!summary) return '正在读取订单与成本数据…'
  const period = summary.period ? `${summary.period} · ` : ''
  return `${period}${summary.dataset.length} 个数据文件 · ${fmtInt(summary.stats.totalOrders)} 行订单`
})

const progress = computed(() => {
  if (store.refreshing || store.refresh.state === 'parsing') return Math.max(4, store.refresh.percent || 4)
  if (store.loadState === 'loading') return Math.max(4, store.refresh.percent || 4)
  return null
})

const progressLabel = computed(() => store.refresh.step || '解析中')

const parseInfo = computed(() => {
  const stats = store.summary?.stats
  if (!stats) return ''
  return `${fmtSeconds(stats.parseMs)}${stats.cached ? ' · 缓存' : ''}`
})

const lastGenerated = computed(() => fmtTime(store.summary?.generatedAt))
</script>

<template>
  <header class="app-header">
    <div class="app-header__inner">
      <div class="brand">
        <div class="brand__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
            <path d="M4 17.5 8.5 12l3.5 3 6.5-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M4 20.5h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity="0.55" />
          </svg>
        </div>
        <div class="brand__text">
          <h1>毛利 · 粗算面板</h1>
          <p>{{ subtitle }}</p>
        </div>
      </div>

      <div class="header-meta">
        <span v-if="store.appInfo" class="badge badge--version" :title="`${store.appInfo.packaged ? '打包版' : '开发版'} · 数据目录 ${store.appInfo.home}`">
          v{{ store.appInfo.version }}
        </span>
        <span class="badge badge--brand">
          <span class="dot" />
          {{ store.summary?.dataset.length ?? 0 }} 文件
        </span>
        <span class="badge">{{ fmtInt(store.summary?.stats.totalOrders ?? 0) }} 行订单</span>
        <span v-if="parseInfo" class="badge">{{ parseInfo }}</span>
        <span v-if="lastGenerated !== '—'" class="badge">更新于 {{ lastGenerated }}</span>
      </div>

      <div class="header-actions">
        <span v-if="store.saving" class="saving-pill">保存中…</span>
        <button
          class="btn btn--ghost btn--icon"
          type="button"
          :title="store.appInfo ? `打开源文件目录：${store.appInfo.excelDir}` : '打开源文件目录'"
          @click="store.openPath('excel')"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path d="M3.5 7.5h6l1.8 2h9.2v9a1.5 1.5 0 0 1-1.5 1.5H4.9a1.5 1.5 0 0 1-1.5-1.5v-11Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
            <path d="M3.5 7.5V5.8a1.3 1.3 0 0 1 1.3-1.3h4l1.6 2h7.8a1.5 1.5 0 0 1 1.5 1.5v1.5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" opacity="0.55" />
          </svg>
        </button>
        <button class="btn btn--ghost btn--icon" type="button" :title="store.theme === 'dark' ? '切换浅色' : '切换深色'" @click="store.toggleTheme()">
          <svg v-if="store.theme === 'dark'" viewBox="0 0 24 24" width="18" height="18" fill="none">
            <circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.8" />
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
          </svg>
        </button>
        <button class="btn" type="button" :disabled="store.refreshing || store.loadState === 'loading'" @click="store.refreshData()">
          <svg :class="{ spin: store.refreshing }" viewBox="0 0 24 24" width="16" height="16" fill="none">
            <path d="M20 12a8 8 0 1 1-2.3-5.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
            <path d="M20 4.5V10h-5.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {{ store.refreshing ? '解析中…' : '刷新数据' }}
        </button>
        <a
          class="btn btn--primary"
          :class="{ 'is-disabled': !store.summary }"
          :href="store.summary ? '/api/export.xlsx' : undefined"
          :aria-disabled="!store.summary"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <path d="M12 3.5v11M7.5 10l4.5 4.5L16.5 10" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M4 19.5h16" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
          </svg>
          导出 Excel
        </a>
      </div>
    </div>

    <Transition name="progress">
      <div v-if="progress !== null" class="progress">
        <div class="progress__track">
          <span class="progress__bar" :style="{ width: `${progress}%` }" />
        </div>
        <span class="progress__label">{{ progressLabel }} · {{ Math.round(progress) }}%</span>
      </div>
    </Transition>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 30;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  background: color-mix(in srgb, var(--bg) 78%, transparent);  border-bottom: 1px solid var(--line);
}

.app-header__inner {
  width: min(1560px, 100%);
  margin: 0 auto;
  padding: 14px clamp(16px, 2.6vw, 40px);
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 240px;
}

.brand__mark {
  width: 42px;
  height: 42px;
  border-radius: 13px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(135deg, var(--brand), #8f7bff 55%, var(--brand-2));
  box-shadow: 0 14px 26px -14px rgba(109, 94, 248, 0.9);
}

.brand__text h1 {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.brand__text p {
  font-size: 12px;
  color: var(--text-3);
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.saving-pill {
  font-size: 12px;
  color: var(--brand);
  font-weight: 600;
  animation: pulse-ring 1.6s infinite;
  border-radius: 8px;
  padding: 4px 8px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.progress {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 clamp(16px, 2.6vw, 40px) 10px;
  width: min(1560px, 100%);
  margin: 0 auto;
}

.progress__track {
  flex: 1;
  height: 4px;
  border-radius: 999px;
  background: var(--line);
  overflow: hidden;
}

.progress__bar {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand), var(--brand-2));
  transition: width 0.4s var(--ease-out);
}

.progress__label {
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.progress-enter-active,
.progress-leave-active {
  transition: opacity 0.2s ease;
}
.progress-enter-from,
.progress-leave-to {
  opacity: 0;
}

.btn.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.badge--version {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--text-2);
  background: var(--surface-solid);
  border: 1px solid var(--line);
  font-weight: 700;
}

@media (max-width: 720px) {
  .header-meta {
    display: none;
  }
  .header-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
