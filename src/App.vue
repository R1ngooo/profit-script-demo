<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useAppStore } from '@/stores/useAppStore'
import AppHeader from '@/components/layout/AppHeader.vue'
import KpiRow from '@/components/layout/KpiRow.vue'
import WarningsBar from '@/components/layout/WarningsBar.vue'
import LoadingState from '@/components/layout/LoadingState.vue'
import ErrorState from '@/components/layout/ErrorState.vue'
import StatusBoard from '@/components/board/StatusBoard.vue'
import PnlSection from '@/components/pnl/PnlSection.vue'
import InputsPanel from '@/components/inputs/InputsPanel.vue'
import PendingSaveBar from '@/components/inputs/PendingSaveBar.vue'
import Toast from '@/components/ui/Toast.vue'

const store = useAppStore()
const ready = computed(() => store.loadState === 'ready' && !!store.summary)
const failed = computed(() => store.loadState === 'error')
const appVersion = computed(() => store.appInfo?.version ?? '')
const dataHome = computed(() => store.appInfo?.home ?? '')

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!store.paramDirty) return
  event.preventDefault()
  event.returnValue = ''
}

function handleKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
  if (!store.paramDirty) return
  event.preventDefault()
  void store.submitParameters()
}

onMounted(() => {
  void store.bootstrap()
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="app-shell">
    <AppHeader />

    <main class="app-main">
      <ErrorState v-if="failed" :message="store.error" @retry="store.bootstrap()" />

      <template v-else-if="!ready">
        <LoadingState :refresh="store.refresh" />
      </template>

      <template v-else>
        <KpiRow />
        <WarningsBar v-if="store.warnings.length" :warnings="store.warnings" />
        <StatusBoard />
        <PnlSection />
        <InputsPanel />

        <footer class="app-foot">
          <span>数据源：excel/订单源（提成用）· excel/成本表（Sheet1）· excel/月消耗表（汇总）</span>
          <span v-if="store.appInfo">
            v{{ appVersion }}{{ store.appInfo.packaged ? ' · 打包版' : '' }} · 数据目录
            <code class="mono">{{ dataHome }}</code> · 源文件不随应用打包，升级保留缓存与参数
          </span>
          <span>退款订单按规则置 0 收入与成本；人工拖拽归类优先于自动规则。</span>
        </footer>
      </template>
    </main>

    <Toast />
    <PendingSaveBar />
  </div>
</template>

<style scoped>
.app-foot {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 4px 0;
  font-size: 11.5px;
  color: var(--text-3);
  text-align: center;
}
</style>
